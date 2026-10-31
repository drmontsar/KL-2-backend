import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import type { Admission } from './admissions';
import { createNotification } from './notifications';

export type TransferRequest = {
  id: string;
  admission_id: string;
  from_doctor_id: string;
  to_doctor_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  message: string | null;
  created_at: Date;
  resolved_at: Date | null;
};

export type TransferRequestDetail = TransferRequest & {
  patient_name: string;
  ward: string | null;
  bed: string | null;
};

export async function createTransferRequest(data: {
  admission_id: string;
  from_doctor_id: string;
  to_doctor_id: string;
  expected_revision: number;
  message?: string;
}): Promise<TransferRequestDetail | 'not_owner' | 'conflict' | 'bad_target'> {
  return db
    .begin(async (tx) => {
      const [target] = await tx`
      SELECT id FROM staff.users
      WHERE id = ${data.to_doctor_id} AND role = 'doctor' AND disabled_at IS NULL
    `;
      if (!target) return 'bad_target';

      const [adm] = await tx`
      SELECT a.id, a.assigned_doctor_id, a.revision, p.name AS patient_name, a.ward, a.bed
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.id = ${data.admission_id} AND a.status = 'active'
        AND a.assigned_doctor_id = ${data.from_doctor_id}
    `;
      if (!adm) return 'not_owner';
      if (Number(adm.revision) !== data.expected_revision) return 'conflict';

      const [req] = await tx<TransferRequest[]>`
      INSERT INTO clinical.transfer_requests
        (admission_id, from_doctor_id, to_doctor_id, message)
      VALUES
        (${data.admission_id}, ${data.from_doctor_id}, ${data.to_doctor_id}, ${data.message ?? null})
      RETURNING *
    `;

      const detail = { ...req, patient_name: adm.patient_name, ward: adm.ward, bed: adm.bed };
      await createNotification(
        {
          user_id: data.to_doctor_id,
          type: 'transfer.requested',
          payload: {
            request_id: req.id,
            admission_id: adm.id,
            from_doctor_id: data.from_doctor_id,
            patient_name: adm.patient_name,
            ward: adm.ward,
            bed: adm.bed,
          },
        },
        tx,
      );
      return detail;
    })
    .catch(rethrowDatabaseError);
}

export async function acceptTransferRequest(
  request_id: string,
  accepting_doctor_id: string,
): Promise<
  { request: TransferRequest; admission: Admission } | 'not_yours' | 'not_pending' | 'conflict'
> {
  return db
    .begin(async (tx) => {
      const [req] = await tx<TransferRequest[]>`
      SELECT * FROM clinical.transfer_requests WHERE id = ${request_id} FOR UPDATE
    `;
      if (!req || req.to_doctor_id !== accepting_doctor_id) return 'not_yours';
      if (req.status !== 'pending') return 'not_pending';

      const [adm] = await tx<Admission[]>`
      UPDATE clinical.admissions
      SET assigned_doctor_id = ${req.to_doctor_id}, revision = revision + 1
      WHERE id = ${req.admission_id}
        AND status = 'active'
        AND assigned_doctor_id = ${req.from_doctor_id}
      RETURNING *
    `;
      if (!adm) return 'conflict';

      await tx`
      UPDATE clinical.staff_assignments SET ends_at = now()
      WHERE admission_id = ${req.admission_id} AND user_id = ${req.from_doctor_id}
        AND assignment_type = 'duty_doctor' AND ends_at IS NULL
    `;
      await tx`
      INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
      SELECT ${req.admission_id}, u.id, 'duty_doctor', ${accepting_doctor_id}
      FROM staff.users u WHERE u.id = ${req.to_doctor_id}
      ON CONFLICT DO NOTHING
    `;
      const [updated] = await tx<TransferRequest[]>`
      UPDATE clinical.transfer_requests
      SET status = 'accepted', resolved_at = now()
      WHERE id = ${request_id}
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${accepting_doctor_id}, 'transfer', 'clinical.admissions', ${req.admission_id}, ${tx.json(adm)})
    `;
      await createNotification(
        {
          user_id: req.from_doctor_id,
          type: 'transfer.accepted',
          payload: { request_id, admission_id: adm.id },
        },
        tx,
      );
      return { request: updated, admission: adm };
    })
    .catch(rethrowDatabaseError);
}

export async function rejectTransferRequest(
  request_id: string,
  rejecting_doctor_id: string,
): Promise<TransferRequestDetail | 'not_yours' | 'not_pending'> {
  return db
    .begin(async (tx) => {
      const [req] = await tx<TransferRequest[]>`
      SELECT * FROM clinical.transfer_requests WHERE id = ${request_id}
    `;
      if (!req) return 'not_yours';
      if (req.to_doctor_id !== rejecting_doctor_id) return 'not_yours';
      if (req.status !== 'pending') return 'not_pending';

      const [updated] = await tx<TransferRequestDetail[]>`
      UPDATE clinical.transfer_requests tr
      SET status = 'rejected', resolved_at = now()
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE tr.id = ${request_id} AND a.id = tr.admission_id
        AND tr.to_doctor_id = ${rejecting_doctor_id} AND tr.status = 'pending'
      RETURNING tr.*, p.name AS patient_name, a.ward, a.bed
    `;
      if (updated)
        await createNotification(
          {
            user_id: updated.from_doctor_id,
            type: 'transfer.rejected',
            payload: { request_id, admission_id: updated.admission_id },
          },
          tx,
        );
      return updated ?? 'not_pending';
    })
    .catch(rethrowDatabaseError);
}

export function listTransferRequests(
  doctor_id: string,
  role: 'incoming' | 'outgoing',
  status?: 'pending',
): Promise<TransferRequestDetail[]> {
  const base = db`
    SELECT tr.*, p.name AS patient_name, a.ward, a.bed
    FROM clinical.transfer_requests tr
    JOIN clinical.admissions a ON a.id = tr.admission_id
    JOIN clinical.patients p ON p.id = a.patient_id
  `;

  if (role === 'incoming' && status === 'pending') {
    return db<TransferRequestDetail[]>`
      ${base}
      WHERE tr.to_doctor_id = ${doctor_id} AND tr.status = 'pending'
      ORDER BY tr.created_at DESC
    `;
  }
  if (role === 'incoming') {
    return db<TransferRequestDetail[]>`
      ${base}
      WHERE tr.to_doctor_id = ${doctor_id}
      ORDER BY tr.created_at DESC
    `;
  }
  if (role === 'outgoing' && status === 'pending') {
    return db<TransferRequestDetail[]>`
      ${base}
      WHERE tr.from_doctor_id = ${doctor_id} AND tr.status = 'pending'
      ORDER BY tr.created_at DESC
    `;
  }
  return db<TransferRequestDetail[]>`
    ${base}
    WHERE tr.from_doctor_id = ${doctor_id}
    ORDER BY tr.created_at DESC
  `;
}
