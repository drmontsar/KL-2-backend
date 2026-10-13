import { db } from '../index';
import { auditLog } from './audit';

export type AllergyEntry = {
  allergen: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe';
};

export type Patient = {
  id: string;
  name: string;
  dob: string;
  sex: 'male' | 'female' | 'other' | 'unknown' | null;
  blood_group: string | null;
  phone: string | null;
  address: string | null;
  abha_id: string | null;
  allergies: AllergyEntry[];
  revision: number;
  created_at: Date;
  created_by: string | null;
};

export async function createPatient(data: {
  name: string;
  dob: string;
  sex?: Patient['sex'];
  blood_group?: string;
  phone?: string;
  address?: string;
  abha_id?: string;
  allergies?: AllergyEntry[];
  created_by?: string;
}): Promise<Patient> {
  const [row] = await db<Patient[]>`
    INSERT INTO clinical.patients (name, dob, sex, blood_group, phone, address, abha_id, allergies, created_by)
    VALUES (
      ${data.name},
      ${data.dob},
      ${data.sex ?? null},
      ${data.blood_group ?? null},
      ${data.phone ?? null},
      ${data.address ?? null},
      ${data.abha_id ?? null},
      ${db.json(data.allergies ?? [])},
      ${data.created_by ?? null}
    )
    RETURNING *
  `;
  await auditLog({
    action: 'create',
    record_table: 'clinical.patients',
    record_id: row.id,
    actor_user_id: data.created_by,
    after: row,
  });
  return row;
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const [row] = await db<Patient[]>`
    SELECT * FROM clinical.patients WHERE id = ${id}
  `;
  return row ?? null;
}

export function listPatients(): Promise<Patient[]> {
  return db<Patient[]>`
    SELECT * FROM clinical.patients ORDER BY name
  `;
}

export async function updatePatient(
  id: string,
  data: Partial<
    Pick<
      Patient,
      | 'name'
      | 'dob'
      | 'sex'
      | 'blood_group'
      | 'phone'
      | 'address'
      | 'abha_id'
      | 'allergies'
    >
  >,
  expected_revision: number
): Promise<Patient | null | 'conflict'> {
  const [row] = await db<Patient[]>`
    UPDATE clinical.patients
    SET
      name        = COALESCE(${data.name ?? null}, name),
      dob         = COALESCE(${data.dob ?? null}::date, dob),
      sex         = COALESCE(${data.sex ?? null}, sex),
      blood_group = COALESCE(${data.blood_group ?? null}, blood_group),
      phone       = COALESCE(${data.phone ?? null}, phone),
      address     = COALESCE(${data.address ?? null}, address),
      abha_id     = COALESCE(${data.abha_id ?? null}, abha_id),
      allergies   = COALESCE(${data.allergies ? db.json(data.allergies) : null}, allergies),
      revision    = revision + 1
    WHERE id = ${id} AND revision = ${expected_revision}
    RETURNING *
  `;
  if (!row) {
    const [exists] = await db`SELECT 1 FROM clinical.patients WHERE id = ${id}`;
    return exists ? 'conflict' : null;
  }
  await auditLog({
    action: 'update',
    record_table: 'clinical.patients',
    record_id: id,
    after: row,
  });
  return row;
}
