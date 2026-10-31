import { z } from 'zod';
import {
  AdmissionHandoffBodyInput,
  AdmissionHandoffSchema,
  Charge,
  CheckinBodyInput,
  DiagnosisSchema,
  DispatchDetailSchema,
  DispatchSchema,
  InvestigationSchema,
  OPDPatientSchema,
  Prescription,
  PrescriptionBodyInput,
  QueueVisitSchema,
  SelectionSchema,
  Visit,
} from '../../contracts/opd';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { createPatientInTransaction } from './patients';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function checkInPatient(body: CheckinBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const patientId =
        body.patient_id ??
        (await createPatientInTransaction(tx, { ...body.patient!, created_by: actor_user_id })).id;
      const [row] = await tx<Visit[]>`
      INSERT INTO opd.visits (patient_id, chief_complaints, patient_notes, reported_medications, chronic_conditions, created_by)
      VALUES (${patientId}, ${tx.json(body.chief_complaints)}, ${body.patient_notes}, ${body.reported_medications}, ${body.chronic_conditions}, ${actor_user_id}) RETURNING *
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'check_in', 'opd.visits', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listOpdQueue() {
  return db<z.infer<typeof QueueVisitSchema>[]>`
    SELECT v.*, jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'uhid', p.uhid,
      'dob', p.dob,
      'sex', p.sex,
      'phone', p.phone,
      'allergies', p.allergies,
      'payer_name', (SELECT payer_name FROM clinical.patient_coverage WHERE patient_id = p.id ORDER BY is_primary DESC, created_at LIMIT 1)
    ) AS patient
    FROM opd.visits v
    JOIN clinical.patients p ON p.id = v.patient_id
    ORDER BY CASE v.status WHEN 'waiting' THEN 0 ELSE 1 END, v.created_at, v.id
    LIMIT 200
  `.catch(rethrowDatabaseError);
}

export async function getOpdVisit(id: string) {
  return db<Visit[]>`SELECT * FROM opd.visits WHERE id = ${id}`.catch(rethrowDatabaseError);
}

export async function getOpdPatient(patient_id: string) {
  return db<z.infer<typeof OPDPatientSchema>[]>`
    SELECT p.id, p.name, p.uhid, p.dob, p.sex, p.phone, p.allergies,
      (SELECT payer_name FROM clinical.patient_coverage WHERE patient_id = p.id ORDER BY is_primary DESC, created_at LIMIT 1) AS payer_name
    FROM clinical.patients p WHERE p.id = ${patient_id}
  `.catch(rethrowDatabaseError);
}

export async function listOpdDiagnoses(id: string) {
  return db<
    z.infer<typeof SelectionSchema>[]
  >`SELECT * FROM opd.visit_diagnoses WHERE visit_id = ${id}`.catch(rethrowDatabaseError);
}

export async function listOpdInvestigations(id: string) {
  return db<
    z.infer<typeof SelectionSchema>[]
  >`SELECT * FROM opd.visit_investigations WHERE visit_id = ${id}`.catch(rethrowDatabaseError);
}

export async function listOpdPrescriptions(id: string) {
  return db<
    Prescription[]
  >`SELECT * FROM opd.prescriptions WHERE visit_id = ${id} ORDER BY created_at`.catch(
    rethrowDatabaseError,
  );
}

export async function listOpdCharges(id: string) {
  return db<Charge[]>`SELECT * FROM opd.visit_charges WHERE visit_id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function listOpdDispatches(
  pharmacy: boolean,
  collection: boolean,
  query: {
    kind?: 'pharmacy' | 'collection' | undefined;
    status?: 'pending' | 'completed' | undefined;
  },
) {
  return db<z.infer<typeof DispatchDetailSchema>[]>`
    SELECT d.*, p.name AS patient_name, p.uhid AS patient_uhid, true AS synthetic,
      CASE WHEN d.kind = 'pharmacy' THEN
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', rx.id, 'medication_id', rx.medication_id, 'brand', m.brand, 'dose', rx.dose, 'route', rx.route, 'frequency', rx.frequency, 'duration', rx.duration) ORDER BY rx.created_at)
          FROM opd.prescriptions rx JOIN clinical.medication_catalog m ON m.id = rx.medication_id WHERE rx.visit_id = d.visit_id), '[]'::jsonb)
      ELSE
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', i.id, 'code', i.code, 'name', catalog.name) ORDER BY i.id)
          FROM opd.visit_investigations i JOIN opd.investigation_catalog catalog ON catalog.code = i.code WHERE i.visit_id = d.visit_id), '[]'::jsonb)
      END AS items
    FROM opd.dispatches d JOIN opd.visits v ON v.id = d.visit_id JOIN clinical.patients p ON p.id = v.patient_id
    WHERE ((${pharmacy} AND d.kind = 'pharmacy') OR (${collection} AND d.kind = 'collection'))
      AND (${query.kind ?? null}::text IS NULL OR d.kind = ${query.kind ?? null}::text)
      AND (${query.status ?? null}::text IS NULL OR d.status = ${query.status ?? null}::text)
    ORDER BY d.created_at, d.id LIMIT 200
  `.catch(rethrowDatabaseError);
}

export async function getOpdDispatch(id: string) {
  return db<z.infer<typeof DispatchSchema>[]>`SELECT * FROM opd.dispatches WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function completeOpdDispatch(actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<
        z.infer<typeof DispatchSchema>[]
      >`UPDATE opd.dispatches SET status = 'completed', completed_at = now(), completed_by = ${actor_user_id} WHERE id = ${id} AND status = 'pending' RETURNING *`;
      if (row)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'complete', 'opd.dispatches', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function searchDiagnosisCatalog(q: string) {
  return db<
    z.infer<typeof DiagnosisSchema>[]
  >`SELECT * FROM opd.diagnosis_catalog WHERE visible AND (code ILIKE ${`%${q}%`} OR description ILIKE ${`%${q}%`}) ORDER BY description LIMIT 50`.catch(
    rethrowDatabaseError,
  );
}

export async function listInvestigationCatalog() {
  return db<
    z.infer<typeof InvestigationSchema>[]
  >`SELECT * FROM opd.investigation_catalog WHERE visible ORDER BY name`.catch(
    rethrowDatabaseError,
  );
}

export async function saveOpdVisit(
  action: 'draft' | 'triage',
  body:
    | {
        expected_revision: number;
        systolic: number;
        diastolic: number;
        pulse: number;
        temperature: number;
        spo2: number;
        weight_kg: number;
      }
    | {
        expected_revision: number;
        consultation_note: string;
        follow_up: '3 days' | '1 week' | '2 weeks' | 'if needed' | 'admit';
      },
  id: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [visit] =
        action === 'triage'
          ? await tx<
              Visit[]
            >`UPDATE opd.visits SET triage = ${tx.json(body as unknown as Json)}, revision = revision + 1 WHERE id = ${id} AND status = 'waiting' AND revision = ${body.expected_revision} RETURNING *`
          : await tx<
              Visit[]
            >`UPDATE opd.visits SET consultation_note = ${'consultation_note' in body ? body.consultation_note : ''}, follow_up = ${'follow_up' in body ? body.follow_up : ''}, revision = revision + 1 WHERE id = ${id} AND status = 'waiting' AND revision = ${body.expected_revision} RETURNING *`;
      if (!visit) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${action}, 'opd.visits', ${id}, ${tx.json(visit as unknown as Json)})`;
      return visit;
    })
    .catch(rethrowDatabaseError);
}

export async function addOpdSelection(
  id: string,
  action: 'diagnoses' | 'investigations',
  code: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [visit] =
        await tx`SELECT id FROM opd.visits WHERE id = ${id} AND status = 'waiting' FOR UPDATE`;
      if (!visit) return null;
      const [row] =
        action === 'diagnoses'
          ? await tx<
              { id: string; visit_id: string; code: string }[]
            >`INSERT INTO opd.visit_diagnoses (visit_id, code) SELECT ${id}, code FROM opd.diagnosis_catalog WHERE code = ${code} RETURNING *`
          : await tx<
              { id: string; visit_id: string; code: string }[]
            >`INSERT INTO opd.visit_investigations (visit_id, code) SELECT ${id}, code FROM opd.investigation_catalog WHERE code = ${code} RETURNING *`;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'add', ${`opd.visit_${action}`}, ${row.id}, ${tx.json(row)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function prescribeMedication(
  id: string,
  body: PrescriptionBodyInput,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [visit] = await tx<
        { patient_id: string }[]
      >`SELECT patient_id FROM opd.visits WHERE id = ${id} AND status = 'waiting' FOR UPDATE`;
      if (!visit) return null;
      const [medication] = await tx<{ id: string; conflict: boolean }[]>`
      SELECT m.id, EXISTS (
        SELECT 1 FROM clinical.patients p, jsonb_array_elements(CASE WHEN jsonb_typeof(p.allergies) = 'array' THEN p.allergies ELSE '[]'::jsonb END) allergy
        JOIN clinical.medication_catalog_allergens ca ON lower(ca.allergen) = lower(trim(allergy->>'allergen'))
        WHERE p.id = ${visit.patient_id} AND ca.medication_id = m.id
      ) AS conflict FROM clinical.medication_catalog m WHERE m.id = ${body.medication_id} AND m.in_stock
    `;
      if (!medication || (medication.conflict && !body.allergy_override_reason)) return null;
      const [row] = await tx<Prescription[]>`
      INSERT INTO opd.prescriptions (visit_id, medication_id, dose, route, frequency, duration, allergy_override_reason, created_by)
      VALUES (${id}, ${body.medication_id}, ${body.dose}, ${body.route}, ${body.frequency}, ${body.duration}, ${medication.conflict ? (body.allergy_override_reason ?? null) : null}, ${actor_user_id}) RETURNING *
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'prescribe', 'opd.prescriptions', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function removeOpdPrescription(
  id: string,
  prescriptionId: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [visit] =
        await tx`SELECT id FROM opd.visits WHERE id = ${id} AND status = 'waiting' FOR UPDATE`;
      if (!visit) return null;
      const [prescription] = await tx<
        Prescription[]
      >`DELETE FROM opd.prescriptions WHERE id = ${prescriptionId} AND visit_id = ${id} RETURNING *`;
      if (!prescription) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before) VALUES (${actor_user_id}, 'remove', 'opd.prescriptions', ${prescriptionId}, ${tx.json(prescription as unknown as Json)})`;
      return prescription;
    })
    .catch(rethrowDatabaseError);
}

export async function requestOpdAdmission(id: string, user: User, body: AdmissionHandoffBodyInput) {
  return db
    .begin(async (tx) => {
      const [visit] = await tx<
        Visit[]
      >`SELECT * FROM opd.visits WHERE id = ${id} AND status = 'seen' AND follow_up = 'admit' AND (${user.job_role === 'administrator'} OR signed_by = ${user.id}) FOR UPDATE`;
      if (!visit) return null;
      const [row] = await tx<z.infer<typeof AdmissionHandoffSchema>[]>`
        INSERT INTO clinical.admission_requests (patient_id, source, diagnosis, clinical_handover, requested_unit_id, requested_by, opd_visit_id)
        VALUES (${visit.patient_id}, 'opd', ${body.diagnosis}, ${visit.consultation_note}, ${body.requested_unit_id}, ${user.id}, ${visit.id}) RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${user.id}, 'opd_handoff', 'clinical.admission_requests', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function signOpdVisit(actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [visit] = await tx<
        Visit[]
      >`UPDATE opd.visits SET status = 'seen', signed_by = ${actor_user_id}, signed_at = now(), revision = revision + 1 WHERE id = ${id} AND status = 'waiting' AND length(trim(consultation_note)) > 0 RETURNING *`;
      if (!visit) return null;
      const [charges] = await tx<Charge[]>`
      INSERT INTO opd.visit_charges (visit_id, consultation_amount, investigation_amount, total_amount)
      SELECT ${id}, 600, COALESCE(sum(c.price), 0), 600 + COALESCE(sum(c.price), 0)
      FROM opd.visit_investigations i JOIN opd.investigation_catalog c ON c.code = i.code WHERE i.visit_id = ${id} RETURNING *
    `;
      await tx`
      INSERT INTO opd.dispatches (visit_id, kind)
      SELECT ${id}::uuid, 'pharmacy' WHERE EXISTS (SELECT 1 FROM opd.prescriptions WHERE visit_id = ${id})
      UNION ALL
      SELECT ${id}::uuid, 'collection' WHERE EXISTS (SELECT 1 FROM opd.visit_investigations WHERE visit_id = ${id})
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'sign', 'opd.visits', ${id}, ${tx.json(visit as unknown as Json)})`;
      return { visit, charges };
    })
    .catch(rethrowDatabaseError);
}
