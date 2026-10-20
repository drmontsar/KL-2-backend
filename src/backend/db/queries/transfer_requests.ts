import { db } from '../index';
import { auditLog } from './audit';
import type { Admission } from './admissions';

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
  const [target] = await db`
    SELECT id FROM staff.users
    WHERE id = ${data.to_doctor_id} AND role = 'doctor' AND disabled_at IS NULL
  `;
  if (!target) return 'bad_target';

  const [adm] = await db`
    SELECT a.id, a.assigned_doctor_id, a.revision, p.name AS patient_name, a.ward, a.bed
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.id = ${data.admission_id} AND a.status = 'active'
  `;
  if (!adm) return 'not_owner';
  if (adm.assigned_doctor_id !== data.from_doctor_id) return 'not_owner';
  if (adm.revision !== data.expected_revision) return 'conflict';

  const [req] = await db<TransferRequest[]>`
    INSERT INTO clinical.transfer_requests
      (admission_id, from_doctor_id, to_doctor_id, message)
    VALUES
      (${data.admission_id}, ${data.from_doctor_id}, ${data.to_doctor_id}, ${data.message ?? null})
    RETURNING *
  `;

  return { ...req, patient_name: adm.patient_name, ward: adm.ward, bed: adm.bed };
}

export async function acceptTransferRequest(
  request_id: string,
  accepting_doctor_id: string
): Promise<{ request: TransferRequest; admission: Admission } | 'not_yours' | 'not_pending' | 'conflict'> {
  const [req] = await db<TransferRequest[]>`
    SELECT * FROM clinical.transfer_requests WHERE id = ${request_id}
  `;
  if (!req) return 'not_yours';
  if (req.to_doctor_id !== accepting_doctor_id) return 'not_yours';
  if (req.status !== 'pending') return 'not_pending';

  const [adm] = await db<Admission[]>`
    UPDATE clinical.admissions
    SET assigned_doctor_id = ${req.to_doctor_id}, revision = revision + 1
    WHERE id = ${req.admission_id}
      AND status = 'active'
      AND assigned_doctor_id = ${req.from_doctor_id}
    RETURNING *
  `;
  if (!adm) return 'conflict';

  const [updated] = await db<TransferRequest[]>`
    UPDATE clinical.transfer_requests
    SET status = 'accepted', resolved_at = now()
    WHERE id = ${request_id}
    RETURNING *
  `;

  await auditLog({
    action: 'transfer',
    record_table: 'clinical.admissions',
    record_id: req.admission_id,
    actor_user_id: req.from_doctor_id,
    after: adm,
  });

  return { request: updated, admission: adm };
}

export async function rejectTransferRequest(
  request_id: string,
  rejecting_doctor_id: string
): Promise<TransferRequestDetail | 'not_yours' | 'not_pending'> {
  const [req] = await db<TransferRequest[]>`
    SELECT * FROM clinical.transfer_requests WHERE id = ${request_id}
  `;
  if (!req) return 'not_yours';
  if (req.to_doctor_id !== rejecting_doctor_id) return 'not_yours';
  if (req.status !== 'pending') return 'not_pending';

  const [updated] = await db<TransferRequestDetail[]>`
    UPDATE clinical.transfer_requests tr
    SET status = 'rejected', resolved_at = now()
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE tr.id = ${request_id} AND a.id = tr.admission_id
    RETURNING tr.*, p.name AS patient_name, a.ward, a.bed
  `;
  return updated;
}

export function listTransferRequests(
  doctor_id: string,
  role: 'incoming' | 'outgoing',
  status?: 'pending'
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
