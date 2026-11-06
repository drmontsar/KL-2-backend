import { z } from 'zod';
import {
  AcceptBodyInput,
  AdmissionRequest,
  ChecklistItem,
  CreateBodyInput,
} from '../../contracts/admission_intake';
import { AdmissionSchema } from '../../contracts/common';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function createAdmissionRequest(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [request] = await tx<AdmissionRequest[]>`
        INSERT INTO clinical.admission_requests (patient_id, source, diagnosis, clinical_handover, requested_unit_id, requested_by)
        VALUES (${body.patient_id}, ${body.source}, ${body.diagnosis}, ${body.clinical_handover}, ${body.requested_unit_id}, ${actor_user_id}) RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'request', 'clinical.admission_requests', ${request.id}, ${tx.json(request as unknown as Json)})`;
      return request;
    })
    .catch(rethrowDatabaseError);
}

export async function listAdmissionRequests(user: User) {
  return db<AdmissionRequest[]>`
    SELECT r.* FROM clinical.admission_requests r WHERE
      ${user.job_role === 'administrator'} OR r.requested_by = ${user.id}
      OR (${user.job_role === 'bed_desk'} AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${user.id} AND m.unit_id = r.requested_unit_id))
    ORDER BY r.requested_at DESC LIMIT 200
  `.catch(rethrowDatabaseError);
}

export async function getAdmissionRequest(id: string) {
  return db<AdmissionRequest[]>`SELECT * FROM clinical.admission_requests WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function acceptAdmissionRequest(
  body: AcceptBodyInput,
  id: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${body.bed_id}, 0))`;
      const [request] = await tx<
        AdmissionRequest[]
      >`SELECT * FROM clinical.admission_requests WHERE id = ${id} AND status = 'pending' FOR UPDATE`;
      if (!request) return null;
      const [bed] = await tx<{ id: string; label: string; ward_name: string; unit_id: string }[]>`
        SELECT b.id, b.label, w.name AS ward_name, w.unit_id FROM organization.beds b
        JOIN organization.rooms r ON r.id = b.room_id JOIN organization.wards w ON w.id = r.ward_id
        WHERE b.id = ${body.bed_id} AND w.unit_id = ${request.requested_unit_id} AND b.operational_state = 'available'
          AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations br WHERE br.bed_id = b.id AND br.released_at IS NULL)
      `;
      if (!bed) return null;
      const [staff] = await tx`
        SELECT c.id FROM staff.users c
        WHERE c.id = ${body.consultant_id} AND c.job_role = 'consultant' AND c.disabled_at IS NULL
      `;
      if (!staff) return null;
      const [nurse] = await tx`
        SELECT u.id FROM staff.users u
        WHERE u.id = ${body.nurse_id} AND u.role = 'nurse' AND u.job_role = 'staff_nurse'
          AND u.disabled_at IS NULL
      `;
      if (!nurse) return null;
      const [admission] = await tx<z.infer<typeof AdmissionSchema>[]>`
        INSERT INTO clinical.admissions (patient_id, ward, bed, bed_id, unit_id, assigned_to, arrival_status, arrived_at, created_by)
        VALUES (${request.patient_id}, ${bed.ward_name}, ${bed.label}, ${bed.id}, ${bed.unit_id}, ${body.nurse_id}, 'incoming', NULL, ${actor_user_id}) RETURNING *
      `;
      await tx`INSERT INTO clinical.bed_assignments (admission_id, bed_id, starts_at, assigned_by) VALUES (${admission.id}, ${bed.id}, ${admission.admitted_at}::timestamptz, ${actor_user_id})`;
      await tx`INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by) VALUES (${admission.id}, ${body.consultant_id}, 'treating_consultant', ${actor_user_id}), (${admission.id}, ${body.nurse_id}, 'primary_nurse', ${actor_user_id})`;
      await tx`INSERT INTO clinical.diagnoses (patient_id, admission_id, description, created_by) VALUES (${request.patient_id}, ${admission.id}, ${request.diagnosis}, ${actor_user_id})`;
      await tx`INSERT INTO clinical.admission_checklist_items (admission_id, code) SELECT ${admission.id}, code FROM unnest(ARRAY['registration_consent','payer','bed_assignment','unit_arrival','admission_orders','doctor_assessment','nursing_assessment','consultant_review']) AS code`;
      await tx`UPDATE clinical.admission_checklist_items SET status = 'completed', completed_by = ${actor_user_id}, completed_at = now(), evidence = 'Managed bed assigned' WHERE admission_id = ${admission.id} AND code = 'bed_assignment'`;
      const notifications = await tx<
        { user_id: string; id: string; type: string; payload: Json; created_at: Date }[]
      >`
        INSERT INTO clinical.notifications (user_id, type, payload)
        SELECT id, 'admission.accepted', ${tx.json({ admission_id: admission.id, request_id: id })}
        FROM staff.users u WHERE u.job_role = 'duty_doctor' AND u.disabled_at IS NULL
          AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.unit_id = ${bed.unit_id} AND m.user_id = u.id)
        RETURNING *
      `;
      for (const notification of notifications)
        await tx`SELECT pg_notify(${notifChannel(notification.user_id)}, ${JSON.stringify(notification)})`;
      const [nurseNotification] = await tx<{ id: string; type: string; payload: Json; created_at: Date }[]>`
        INSERT INTO clinical.notifications (user_id, type, payload)
        VALUES (${body.nurse_id}, 'admission.incoming', ${tx.json({ admission_id: admission.id, request_id: id })}) RETURNING *
      `;
      await tx`SELECT pg_notify(${notifChannel(body.nurse_id)}, ${JSON.stringify(nurseNotification)})`;
      const [updated] = await tx<
        AdmissionRequest[]
      >`UPDATE clinical.admission_requests SET status = 'accepted', resolved_by = ${actor_user_id}, resolved_at = now(), admission_id = ${admission.id} WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'accept', 'clinical.admission_requests', ${id}, ${tx.json(updated as unknown as Json)}), (${actor_user_id}, 'create', 'clinical.admissions', ${admission.id}, ${tx.json(admission as unknown as Json)})`;
      return { request: updated, admission };
    })
    .catch(rethrowDatabaseError);
}

export async function declineAdmissionRequest(actor_user_id: string, reason: string, id: string) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<
        AdmissionRequest[]
      >`UPDATE clinical.admission_requests SET status = 'declined', resolved_by = ${actor_user_id}, resolved_at = now(), decline_reason = ${reason} WHERE id = ${id} AND status = 'pending' RETURNING *`;
      if (row)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'decline', 'clinical.admission_requests', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function takeNursingAssignment(actor_user_id: string, id: string) {
  return db
    .begin(async (tx) => {
      const [admission] = await tx<z.infer<typeof AdmissionSchema>[]>`
      UPDATE clinical.admissions a SET assigned_to = ${actor_user_id}, revision = a.revision + 1
      WHERE a.id = ${id} AND a.status = 'active' AND a.assigned_to IS NULL
        AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${actor_user_id} AND m.unit_id = a.unit_id)
      RETURNING a.*
    `;
      if (!admission) return null;
      await tx`INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by) VALUES (${id}, ${actor_user_id}, 'primary_nurse', ${actor_user_id})`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'take_nursing_assignment', 'clinical.admissions', ${id}, ${tx.json(admission as unknown as Json)})`;
      return admission;
    })
    .catch(rethrowDatabaseError);
}

export async function confirmPatientInBed(id: string, actor_user_id: string) {
  return db.begin(async (tx) => {
    const [admission] = await tx<z.infer<typeof AdmissionSchema>[]>`
      UPDATE clinical.admissions a
      SET arrival_status = 'admitted', arrived_at = now(), revision = a.revision + 1
      FROM staff.users u
      WHERE a.id = ${id} AND a.status = 'active' AND a.arrival_status = 'incoming'
        AND a.assigned_to = ${actor_user_id} AND u.id = ${actor_user_id}
        AND u.job_role = 'staff_nurse' AND u.disabled_at IS NULL
      RETURNING a.*
    `;
    if (!admission) return null;
    await tx`
      UPDATE clinical.admission_checklist_items
      SET status = 'completed', completed_by = ${actor_user_id}, completed_at = now(), evidence = 'Patient confirmed in bed'
      WHERE admission_id = ${id} AND code = 'unit_arrival' AND status = 'pending'
    `;
    await tx`INSERT INTO clinical.observation_schedules (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
      VALUES (${id}, 720, now(), 'news2_policy', 'NEWS2-2017-scale-1', ${actor_user_id})`;
    await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'confirm_in_bed', 'clinical.admissions', ${id}, ${tx.json(admission as unknown as Json)})`;
    return admission;
  }).catch(rethrowDatabaseError);
}

export async function listAdmissionChecklist(id: string) {
  return db<
    ChecklistItem[]
  >`SELECT * FROM clinical.admission_checklist_items WHERE admission_id = ${id} ORDER BY code`.catch(
    rethrowDatabaseError,
  );
}

export async function getAdmissionChecklistItem(id: string) {
  return db<
    ChecklistItem[]
  >`SELECT * FROM clinical.admission_checklist_items WHERE id = ${id}`.catch(rethrowDatabaseError);
}

export async function completeAdmissionChecklistItem(
  actor_user_id: string,
  evidence: string,
  id: string,
) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<ChecklistItem[]>`
      UPDATE clinical.admission_checklist_items i SET status = 'completed', completed_by = ${actor_user_id}, completed_at = now(), evidence = ${evidence}
      FROM clinical.admissions a WHERE i.id = ${id} AND i.admission_id = a.id AND a.status = 'active' AND i.status = 'pending' AND i.code NOT IN ('unit_arrival', 'doctor_assessment') RETURNING i.*
    `;
      if (row)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'complete', 'clinical.admission_checklist_items', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}
