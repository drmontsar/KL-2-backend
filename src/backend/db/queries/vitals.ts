import { db } from '../index';
import { auditLog } from './audit';

export type Vitals = {
  id: string;
  admission_id: string;
  recorded_by: string;
  recorded_at: Date;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  heart_rate: number | null;
  spo2: number | null;
  resp_rate: number | null;
  temperature: number | null;
  glucose: number | null;
};

export async function recordVitals(data: {
  admission_id: string;
  recorded_by: string;
  bp_systolic?: number;
  bp_diastolic?: number;
  heart_rate?: number;
  spo2?: number;
  resp_rate?: number;
  temperature?: number;
  glucose?: number;
}): Promise<Vitals> {
  const [row] = await db<Vitals[]>`
    INSERT INTO clinical.vitals
      (admission_id, recorded_by, bp_systolic, bp_diastolic, heart_rate, spo2, resp_rate, temperature, glucose)
    VALUES
      (${data.admission_id}, ${data.recorded_by},
       ${data.bp_systolic ?? null}, ${data.bp_diastolic ?? null},
       ${data.heart_rate ?? null}, ${data.spo2 ?? null},
       ${data.resp_rate ?? null}, ${data.temperature ?? null},
       ${data.glucose ?? null})
    RETURNING *
  `;
  await auditLog({
    action: 'create',
    record_table: 'clinical.vitals',
    record_id: row.id,
    actor_user_id: data.recorded_by,
    after: row,
  });
  return row;
}

export function listVitalsByAdmission(
  admission_id: string,
  limit = 20
): Promise<Vitals[]> {
  return db<Vitals[]>`
    SELECT * FROM clinical.vitals
    WHERE admission_id = ${admission_id}
    ORDER BY recorded_at DESC
    LIMIT ${limit}
  `;
}

export function latestVitals(admission_id: string): Promise<Vitals | null> {
  return db<Vitals[]>`
    SELECT * FROM clinical.vitals
    WHERE admission_id = ${admission_id}
    ORDER BY recorded_at DESC
    LIMIT 1
  `.then((rows) => rows[0] ?? null);
}
