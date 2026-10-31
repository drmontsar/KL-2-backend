import type postgres from 'postgres';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { patientAccessFilter } from './access';
import type { User } from './users';

export type AllergyEntry = {
  allergen: string;
  reaction?: string;
  severity?: 'mild' | 'moderate' | 'severe';
};

export type Patient = {
  id: string;
  name: string;
  uhid: string;
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

type CreatePatientData = {
  name: string;
  dob: string;
  sex?: Patient['sex'];
  blood_group?: string;
  phone?: string;
  address?: string;
  abha_id?: string;
  allergies?: AllergyEntry[];
  created_by?: string;
};

export async function createPatientInTransaction(
  tx: postgres.TransactionSql,
  data: CreatePatientData,
): Promise<Patient> {
  const [row] = await tx<Patient[]>`
    INSERT INTO clinical.patients (name, dob, sex, blood_group, phone, address, abha_id, allergies, created_by)
    VALUES (
      ${data.name},
      ${data.dob},
      ${data.sex ?? null},
      ${data.blood_group ?? null},
      ${data.phone ?? null},
      ${data.address ?? null},
      ${data.abha_id ?? null},
      ${tx.json(data.allergies ?? [])},
      ${data.created_by ?? null}
    )
    RETURNING *
  `;
  await tx`
    INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
    VALUES (${row.id}, 'uhid', ${row.uhid}, 'KliniK')
  `;
  if (data.abha_id) {
    await tx`
      INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
      VALUES (${row.id}, 'abha', ${data.abha_id}, 'ABHA')
    `;
  }
  if (data.phone) {
    await tx`
      INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
      VALUES (${row.id}, 'phone', 'Primary', ${data.phone}, true)
    `;
  }
  if (data.address) {
    await tx`
      INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
      VALUES (${row.id}, 'address', 'Home', ${data.address}, true)
    `;
  }
  await tx`
    INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
    VALUES (${data.created_by ?? null}, 'create', 'clinical.patients', ${row.id}, ${tx.json(row)})
  `;
  return row;
}

export function createPatient(data: CreatePatientData): Promise<Patient> {
  return db.begin((tx) => createPatientInTransaction(tx, data)).catch(rethrowDatabaseError);
}

export async function getPatientById(id: string): Promise<Patient | null> {
  const [row] = await db<Patient[]>`
    SELECT * FROM clinical.patients WHERE id = ${id}
  `;
  return row ?? null;
}

export function listPatientsForUser(user: User): Promise<Patient[]> {
  return db<
    Patient[]
  >`SELECT p.* FROM clinical.patients p WHERE ${patientAccessFilter(user)} ORDER BY p.name`;
}

export async function updatePatient(
  id: string,
  data: Partial<
    Pick<
      Patient,
      'name' | 'dob' | 'sex' | 'blood_group' | 'phone' | 'address' | 'abha_id' | 'allergies'
    >
  >,
  expected_revision: number,
  actor_user_id: string,
): Promise<Patient | null | 'conflict'> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Patient[]>`
      UPDATE clinical.patients
      SET
        name        = COALESCE(${data.name ?? null}, name),
        dob         = COALESCE(${data.dob ?? null}::date, dob),
        sex         = COALESCE(${data.sex ?? null}, sex),
        blood_group = COALESCE(${data.blood_group ?? null}, blood_group),
        phone       = CASE WHEN ${data.phone !== undefined} THEN NULLIF(${data.phone ?? null}, '') ELSE phone END,
        address     = CASE WHEN ${data.address !== undefined} THEN NULLIF(${data.address ?? null}, '') ELSE address END,
        abha_id     = CASE WHEN ${data.abha_id !== undefined} THEN NULLIF(${data.abha_id ?? null}, '') ELSE abha_id END,
        allergies   = COALESCE(${data.allergies ? tx.json(data.allergies) : null}, allergies),
        revision    = revision + 1
      WHERE id = ${id} AND revision = ${expected_revision}
      RETURNING *
    `;
      if (!row) {
        const [exists] = await tx`SELECT 1 FROM clinical.patients WHERE id = ${id}`;
        return exists ? 'conflict' : null;
      }
      if (data.phone !== undefined && !data.phone)
        await tx`DELETE FROM clinical.patient_contacts WHERE patient_id = ${id} AND type = 'phone' AND is_primary`;
      if (data.phone) {
        await tx`
        INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
        VALUES (${id}, 'phone', 'Primary', ${data.phone}, true)
        ON CONFLICT (patient_id, type) WHERE is_primary
        DO UPDATE SET value = EXCLUDED.value
      `;
      }
      if (data.address !== undefined && !data.address)
        await tx`DELETE FROM clinical.patient_contacts WHERE patient_id = ${id} AND type = 'address' AND is_primary`;
      if (data.address) {
        await tx`
        INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
        VALUES (${id}, 'address', 'Home', ${data.address}, true)
        ON CONFLICT (patient_id, type) WHERE is_primary
        DO UPDATE SET value = EXCLUDED.value
      `;
      }
      if (data.abha_id !== undefined && !data.abha_id)
        await tx`DELETE FROM clinical.patient_identifiers WHERE patient_id = ${id} AND type = 'abha'`;
      if (data.abha_id) {
        const [identifier] =
          await tx`SELECT id FROM clinical.patient_identifiers WHERE patient_id = ${id} AND type = 'abha'`;
        if (identifier) {
          await tx`UPDATE clinical.patient_identifiers SET value = ${data.abha_id} WHERE id = ${identifier.id}`;
        } else {
          await tx`
          INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
          VALUES (${id}, 'abha', ${data.abha_id}, 'ABHA')
        `;
        }
      }
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'update', 'clinical.patients', ${id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}
