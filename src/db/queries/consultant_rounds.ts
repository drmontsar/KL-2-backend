import { RoundBodyInput } from '../../contracts/consultant_rounds';

type Round = {
  id: string;
  admission_id: string;
  consultant_id: string;
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  note_id: string;
  signed_at: Date;
};
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { type Order } from './orders';

type Json = Parameters<(typeof db)['json']>[0];

export async function listConsultantWorklist(actor_user_id: string) {
  return db<
    {
      admission_id: string;
      patient_id: string;
      patient_name: string;
      ward: string | null;
      bed: string | null;
      severity: 'stable' | 'watcher' | 'unstable';
      news2_score: number | null;
      last_round_at: Date | null;
      seen_today: boolean;
    }[]
  >`
    SELECT a.id AS admission_id, p.id AS patient_id, p.name AS patient_name, a.ward, a.bed, a.severity,
           n.news2_score, round.signed_at AS last_round_at,
           COALESCE(round.signed_at >= date_trunc('day', now()), false) AS seen_today
    FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id
    LEFT JOIN clinical.latest_news2 n ON n.admission_id = a.id
    LEFT JOIN LATERAL (
      SELECT signed_at FROM clinical.consultant_rounds
      WHERE admission_id = a.id AND consultant_id = ${actor_user_id} ORDER BY signed_at DESC LIMIT 1
    ) round ON true
    WHERE a.status = 'active' AND (
      a.assigned_doctor_id = ${actor_user_id} OR EXISTS (
        SELECT 1 FROM clinical.staff_assignments sa
        WHERE sa.admission_id = a.id AND sa.user_id = ${actor_user_id}
          AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL
      )
    )
    ORDER BY seen_today, n.news2_score DESC NULLS LAST,
      CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END, p.name
  `.catch(rethrowDatabaseError);
}

export async function getConsultantContext(id: string, actor_user_id: string) {
  return db`
    SELECT a.id FROM clinical.admissions a
    WHERE a.id = ${id} AND a.status = 'active' AND (
      a.assigned_doctor_id = ${actor_user_id} OR EXISTS (
        SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${actor_user_id}
          AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL
      )
    )
  `.catch(rethrowDatabaseError);
}

export async function signConsultantRound(body: RoundBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [admission] = await tx`
      SELECT a.id FROM clinical.admissions a
      WHERE a.id = ${body.admission_id} AND a.status = 'active' AND (
        a.assigned_doctor_id = ${actor_user_id} OR EXISTS (
          SELECT 1 FROM clinical.staff_assignments sa WHERE sa.admission_id = a.id AND sa.user_id = ${actor_user_id}
            AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL
        )
      ) FOR UPDATE OF a
    `;
      if (!admission) return null;
      const text = `Subjective: ${body.subjective}\nObjective: ${body.objective}\nAssessment: ${body.assessment}\nPlan: ${body.plan}`;
      const [note] = await tx<{ id: string }[]>`
      INSERT INTO clinical.notes (admission_id, kind, draft_body, created_by)
      VALUES (${body.admission_id}, 'consultant_round', ${text}, ${actor_user_id}) RETURNING id
    `;
      const [version] = await tx<{ id: string }[]>`
      INSERT INTO clinical.note_versions (note_id, version_no, body, confirmed_by)
      VALUES (${note.id}, 1, ${text}, ${actor_user_id}) RETURNING id
    `;
      const [round] = await tx<Round[]>`
      INSERT INTO clinical.consultant_rounds (admission_id, consultant_id, subjective, objective, assessment, plan, note_id)
      VALUES (${body.admission_id}, ${actor_user_id}, ${body.subjective}, ${body.objective}, ${body.assessment}, ${body.plan}, ${note.id}) RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'sign', 'clinical.consultant_rounds', ${round.id}, ${tx.json(round as unknown as Json)}),
             (${actor_user_id}, 'confirm', 'clinical.note_versions', ${version.id}, ${tx.json({ note_id: note.id, round_id: round.id })})
    `;
      const orders: Order[] = [];
      for (const order of body.orders) {
        const [row] = await tx<Order[]>`
        INSERT INTO clinical.orders (admission_id, kind, payload, priority, created_by, status, confirmed_by, confirmed_at, consultant_round_id)
        VALUES (${body.admission_id}, ${order.kind}, ${tx.json(order.payload as Json)}, ${order.priority}, ${actor_user_id}, 'confirmed', ${actor_user_id}, now(), ${round.id}) RETURNING *
      `;
        await tx`
        INSERT INTO clinical.tasks (order_id, admission_id, due_at)
        VALUES (${row.id}, ${body.admission_id}, ${order.due_at ? new Date(order.due_at) : null})
      `;
        await tx`
        INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
        VALUES (${actor_user_id}, 'confirm', 'clinical.orders', ${row.id}, ${tx.json(row as unknown as Json)})
      `;
        orders.push(row);
      }
      return { round, orders };
    })
    .catch(rethrowDatabaseError);
}
