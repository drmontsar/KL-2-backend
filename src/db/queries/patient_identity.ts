import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { patientAccessFilter } from './access';
import { admissionAccessFilter } from './admissions';
import type { Patient } from './patients';
import type { User } from './users';

export type PatientIdentifier = {
  id: string;
  patient_id: string;
  type: 'uhid' | 'abha' | 'mrn' | 'external';
  value: string;
  issuer: string | null;
  created_at: Date;
};
export type PatientContact = {
  id: string;
  patient_id: string;
  type: 'phone' | 'email' | 'address';
  label: string | null;
  value: string;
  is_primary: boolean;
  created_at: Date;
};
export type NextOfKin = {
  id: string;
  patient_id: string;
  name: string;
  relationship: string;
  phone: string;
  address: string | null;
  is_primary: boolean;
  created_at: Date;
};
export type PatientCoverage = {
  id: string;
  patient_id: string;
  payer_name: string;
  policy_number: string;
  member_id: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_primary: boolean;
  created_at: Date;
};
export type BedAssignment = {
  id: string;
  admission_id: string;
  bed_id: string;
  starts_at: Date;
  ends_at: Date | null;
  assigned_by: string | null;
  end_reason: string | null;
  ward_name: string;
  room_name: string;
  bed_label: string;
};

export async function getPatientIdentity(patient_id: string) {
  const [identifiers, contacts, next_of_kin, coverage] = await Promise.all([
    db<
      PatientIdentifier[]
    >`SELECT * FROM clinical.patient_identifiers WHERE patient_id = ${patient_id} ORDER BY type, created_at`,
    db<
      PatientContact[]
    >`SELECT * FROM clinical.patient_contacts WHERE patient_id = ${patient_id} ORDER BY is_primary DESC, type, created_at`,
    db<
      NextOfKin[]
    >`SELECT * FROM clinical.next_of_kin WHERE patient_id = ${patient_id} ORDER BY is_primary DESC, created_at`,
    db<
      PatientCoverage[]
    >`SELECT * FROM clinical.patient_coverage WHERE patient_id = ${patient_id} ORDER BY is_primary DESC, created_at`,
  ]);
  return { identifiers, contacts, next_of_kin, coverage };
}

export async function addPatientIdentifier(data: {
  patient_id: string;
  type: PatientIdentifier['type'];
  value: string;
  issuer?: string;
  actor_user_id: string;
}): Promise<PatientIdentifier> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.patients WHERE id = ${data.patient_id} FOR UPDATE`;
      const [row] = await tx<PatientIdentifier[]>`
      INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
      VALUES (${data.patient_id}, ${data.type}, ${data.value}, ${data.issuer ?? null})
      RETURNING *
    `;
      if (data.type === 'abha') {
        await tx`UPDATE clinical.patients SET abha_id = ${data.value}, revision = revision + 1 WHERE id = ${data.patient_id}`;
      }
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.actor_user_id}, 'add_identifier', 'clinical.patient_identifiers', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function addPatientContact(data: {
  patient_id: string;
  type: PatientContact['type'];
  label?: string;
  value: string;
  is_primary: boolean;
  actor_user_id: string;
}): Promise<PatientContact> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.patients WHERE id = ${data.patient_id} FOR UPDATE`;
      if (data.is_primary) {
        await tx`UPDATE clinical.patient_contacts SET is_primary = false WHERE patient_id = ${data.patient_id} AND type = ${data.type}`;
      }
      const [row] = await tx<PatientContact[]>`
      INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
      VALUES (${data.patient_id}, ${data.type}, ${data.label ?? null}, ${data.value}, ${data.is_primary})
      RETURNING *
    `;
      if (data.is_primary && data.type === 'phone') {
        await tx`UPDATE clinical.patients SET phone = ${data.value}, revision = revision + 1 WHERE id = ${data.patient_id}`;
      }
      if (data.is_primary && data.type === 'address') {
        await tx`UPDATE clinical.patients SET address = ${data.value}, revision = revision + 1 WHERE id = ${data.patient_id}`;
      }
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.actor_user_id}, 'add_contact', 'clinical.patient_contacts', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function addNextOfKin(
  data: Omit<NextOfKin, 'id' | 'created_at'> & { actor_user_id: string },
): Promise<NextOfKin> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.patients WHERE id = ${data.patient_id} FOR UPDATE`;
      if (data.is_primary)
        await tx`UPDATE clinical.next_of_kin SET is_primary = false WHERE patient_id = ${data.patient_id}`;
      const [row] = await tx<NextOfKin[]>`
      INSERT INTO clinical.next_of_kin (patient_id, name, relationship, phone, address, is_primary)
      VALUES (${data.patient_id}, ${data.name}, ${data.relationship}, ${data.phone}, ${data.address}, ${data.is_primary})
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.actor_user_id}, 'add_next_of_kin', 'clinical.next_of_kin', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function addCoverage(
  data: Omit<PatientCoverage, 'id' | 'created_at'> & { actor_user_id: string },
): Promise<PatientCoverage> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.patients WHERE id = ${data.patient_id} FOR UPDATE`;
      if (data.is_primary)
        await tx`UPDATE clinical.patient_coverage SET is_primary = false WHERE patient_id = ${data.patient_id}`;
      const [row] = await tx<PatientCoverage[]>`
      INSERT INTO clinical.patient_coverage
        (patient_id, payer_name, policy_number, member_id, valid_from, valid_until, is_primary)
      VALUES
        (${data.patient_id}, ${data.payer_name}, ${data.policy_number}, ${data.member_id},
         ${data.valid_from}::date, ${data.valid_until}::date, ${data.is_primary})
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.actor_user_id}, 'add_coverage', 'clinical.patient_coverage', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export function findDuplicateCandidates(
  data: {
    name: string;
    dob: string;
    phone?: string;
    abha_id?: string;
  },
  user: User,
): Promise<Pick<Patient, 'id' | 'uhid' | 'name' | 'dob' | 'phone' | 'abha_id'>[]> {
  return db`
    SELECT p.id, p.uhid, p.name, p.dob, p.phone, p.abha_id FROM clinical.patients p
    WHERE ${patientAccessFilter(user)} AND (
      (regexp_replace(${data.phone ?? ''}, '\\D', '', 'g') <> '' AND (
        regexp_replace(COALESCE(p.phone, ''), '\\D', '', 'g') = regexp_replace(${data.phone ?? ''}, '\\D', '', 'g')
        OR EXISTS (SELECT 1 FROM clinical.patient_contacts pc WHERE pc.patient_id = p.id AND pc.type = 'phone'
          AND regexp_replace(pc.value, '\\D', '', 'g') = regexp_replace(${data.phone ?? ''}, '\\D', '', 'g'))
      ))
      OR (${data.abha_id ?? null}::text IS NOT NULL AND (p.abha_id = ${data.abha_id ?? ''}
        OR EXISTS (SELECT 1 FROM clinical.patient_identifiers pi WHERE pi.patient_id = p.id AND pi.type = 'abha' AND pi.value = ${data.abha_id ?? ''})))
      OR (p.dob = ${data.dob}::date AND similarity(lower(p.name), lower(${data.name})) >= 0.65)
    )
    ORDER BY p.name LIMIT 20
  `;
}

export function searchPatientsForUser(
  query: string,
  user: User,
  limit: number,
): Promise<Patient[]> {
  const match = db`
    (p.name ILIKE ${`%${query}%`}
     OR p.uhid ILIKE ${`%${query}%`}
     OR p.abha_id ILIKE ${`%${query}%`}
     OR p.phone ILIKE ${`%${query}%`}
     OR EXISTS (SELECT 1 FROM clinical.patient_identifiers pi WHERE pi.patient_id = p.id AND pi.value ILIKE ${`%${query}%`})
     OR EXISTS (SELECT 1 FROM clinical.patient_contacts pc WHERE pc.patient_id = p.id AND pc.value ILIKE ${`%${query}%`})
     OR EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.patient_id = p.id AND a.status = 'active' AND a.bed ILIKE ${`%${query}%`} AND (
       ${admissionAccessFilter(user)} OR (${user.job_role === 'bed_desk'} AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${user.id} AND m.unit_id = a.unit_id))
     )))
  `;
  return db<Patient[]>`
    SELECT p.* FROM clinical.patients p WHERE ${match} AND ${patientAccessFilter(user)}
    ORDER BY p.name LIMIT ${limit}
  `;
}

export function listBedAssignmentHistory(admission_id: string): Promise<BedAssignment[]> {
  return db<BedAssignment[]>`
    SELECT ba.*, w.name AS ward_name, r.name AS room_name, b.label AS bed_label
    FROM clinical.bed_assignments ba
    JOIN organization.beds b ON b.id = ba.bed_id
    JOIN organization.rooms r ON r.id = b.room_id
    JOIN organization.wards w ON w.id = r.ward_id
    WHERE ba.admission_id = ${admission_id}
    ORDER BY ba.starts_at DESC
  `;
}
