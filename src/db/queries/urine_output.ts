import type postgres from 'postgres';
import { notifChannel } from './notifications';

type Json = postgres.JSONValue;
export type UrineOutput = {
  status: 'low' | 'normal' | 'insufficient_data';
  weight_kg: number | null;
  previous_hour_ml: number | null;
  preceding_hour_ml: number | null;
};

export async function getUrineOutput(
  sql: postgres.ISql,
  admissionId: string,
): Promise<UrineOutput> {
  const [measurement] = await sql<Omit<UrineOutput, 'status'>[]>`
    SELECT
      (SELECT weight_kg FROM clinical.patient_weights WHERE admission_id = ${admissionId} AND measured_at <= now() AND measured_at >= now() - interval '7 days' ORDER BY measured_at DESC LIMIT 1) AS weight_kg,
      (SELECT sum(volume_ml)::double precision FROM clinical.fluid_entries WHERE admission_id = ${admissionId} AND direction = 'output' AND lower(category) = 'urine' AND occurred_at >= date_trunc('hour', now()) - interval '1 hour' AND occurred_at < date_trunc('hour', now())) AS previous_hour_ml,
      (SELECT sum(volume_ml)::double precision FROM clinical.fluid_entries WHERE admission_id = ${admissionId} AND direction = 'output' AND lower(category) = 'urine' AND occurred_at >= date_trunc('hour', now()) - interval '2 hours' AND occurred_at < date_trunc('hour', now()) - interval '1 hour') AS preceding_hour_ml
  `;
  const { weight_kg, previous_hour_ml, preceding_hour_ml } = measurement;
  const status =
    weight_kg === null || previous_hour_ml === null || preceding_hour_ml === null
      ? 'insufficient_data'
      : previous_hour_ml < weight_kg * 0.5 && preceding_hour_ml < weight_kg * 0.5
        ? 'low'
        : 'normal';
  return { ...measurement, status };
}

// Caller locks the active admission so concurrent measurements cannot lose an escalation.
export async function escalateLowUrine(
  tx: postgres.TransactionSql,
  admissionId: string,
  actorId: string,
): Promise<void> {
  const measurement = await getUrineOutput(tx, admissionId);
  if (measurement.status !== 'low') return;
  const [alert] = await tx<{ id: string }[]>`
    INSERT INTO clinical.alerts (admission_id, type, severity, message)
    VALUES (${admissionId}, 'low_urine_output', 'warning', 'Urine output below 0.5 ml/kg/h for two completed hours')
    ON CONFLICT (admission_id, type) WHERE type = 'low_urine_output' AND status IN ('active','acknowledged') DO NOTHING RETURNING id
  `;
  if (!alert) return;
  await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actorId}, 'create', 'clinical.alerts', ${alert.id}, ${tx.json(measurement)})`;
  const notifications = await tx<{ user_id: string; id: string; type: string; payload: Json; created_at: Date }[]>`
    INSERT INTO clinical.notifications (user_id, type, payload)
    SELECT id, 'nursing.low_urine_output', ${tx.json({ admission_id: admissionId, alert_id: alert.id })}
    FROM staff.users u WHERE u.job_role = 'duty_doctor' AND u.disabled_at IS NULL
      AND EXISTS (SELECT 1 FROM clinical.admissions a JOIN staff.unit_memberships m ON m.unit_id = a.unit_id
        WHERE a.id = ${admissionId} AND m.user_id = u.id) RETURNING *
  `;
  for (const notification of notifications)
    await tx`SELECT pg_notify(${notifChannel(notification.user_id)}, ${JSON.stringify(notification)})`;
}
