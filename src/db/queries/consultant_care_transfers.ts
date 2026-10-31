import { CreateBodyInput } from '../../contracts/consultant_care_transfers';

type Transfer = {
  id: string;
  admission_id: string;
  requested_by: string;
  from_consultant_id: string;
  to_consultant_id: string;
  reason: string;
  discussed_with_current: boolean;
  patient_family_informed: boolean;
  status: 'pending_release' | 'pending_acceptance' | 'accepted' | 'declined' | 'withdrawn';
  released_at: Date | null;
  resolved_at: Date | null;
  resolution_reason: string | null;
  created_at: Date;
};
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';

type Json = Parameters<(typeof db)['json']>[0];

export async function listConsultantCareTransfers(actor_user_id: string) {
  return db<Transfer[]>`
    SELECT * FROM clinical.consultant_care_transfers
    WHERE requested_by = ${actor_user_id} OR from_consultant_id = ${actor_user_id} OR to_consultant_id = ${actor_user_id}
    ORDER BY created_at DESC LIMIT 100
  `.catch(rethrowDatabaseError);
}

export async function requestConsultantCareTransfer(actor_user_id: string, body: CreateBodyInput) {
  return db
    .begin(async (tx) => {
      const [transfer] = await tx<Transfer[]>`
        INSERT INTO clinical.consultant_care_transfers
          (admission_id, requested_by, from_consultant_id, to_consultant_id, reason, discussed_with_current, patient_family_informed)
        SELECT a.id, ${actor_user_id}, sa.user_id, u.id, ${body.reason}, true, true
        FROM clinical.admissions a
        JOIN clinical.staff_assignments sa ON sa.admission_id = a.id AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL
        JOIN staff.users u ON u.id = ${body.to_consultant_id} AND u.job_role = 'consultant' AND u.disabled_at IS NULL
        WHERE a.id = ${body.admission_id} AND a.status = 'active' AND sa.user_id <> u.id
        RETURNING *
      `;
      if (!transfer) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'request', 'clinical.consultant_care_transfers', ${transfer.id}, ${tx.json(transfer as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
        INSERT INTO clinical.notifications (user_id, type, payload)
        VALUES (${transfer.from_consultant_id}, 'care_transfer.release_requested', ${tx.json({ transfer_id: transfer.id, admission_id: transfer.admission_id })}) RETURNING *
      `;
      await tx`SELECT pg_notify(${notifChannel(transfer.from_consultant_id)}, ${JSON.stringify(notification)})`;
      return transfer;
    })
    .catch(rethrowDatabaseError);
}

export async function transitionConsultantCareTransfer(
  id: string,
  action: 'release' | 'accept' | 'decline' | 'withdraw',
  actor_user_id: string,
  reason: string | null,
) {
  return db
    .begin(async (tx) => {
      const [current] = await tx<
        Transfer[]
      >`SELECT * FROM clinical.consultant_care_transfers WHERE id = ${id} FOR UPDATE`;
      if (!current) return 'forbidden' as const;
      const authorized =
        action === 'release'
          ? current.from_consultant_id === actor_user_id
          : action === 'accept' || action === 'decline'
            ? current.to_consultant_id === actor_user_id
            : current.requested_by === actor_user_id ||
              current.from_consultant_id === actor_user_id;
      if (!authorized) return 'forbidden' as const;
      const valid =
        action === 'release'
          ? current.status === 'pending_release'
          : action === 'accept' || action === 'decline'
            ? current.status === 'pending_acceptance'
            : current.status === 'pending_release' || current.status === 'pending_acceptance';
      if (!valid) return 'conflict' as const;
      if (action === 'accept') {
        const [admission] =
          await tx`SELECT id FROM clinical.admissions WHERE id = ${current.admission_id} AND status = 'active' FOR UPDATE`;
        if (!admission) return 'conflict' as const;
        const [previous] = await tx`
          UPDATE clinical.staff_assignments SET ends_at = now()
          WHERE admission_id = ${current.admission_id} AND user_id = ${current.from_consultant_id}
            AND assignment_type = 'treating_consultant' AND ends_at IS NULL RETURNING id
        `;
        if (!previous) return 'conflict' as const;
        await tx`
          INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
          VALUES (${current.admission_id}, ${current.to_consultant_id}, 'treating_consultant', ${actor_user_id})
        `;
      }
      const status =
        action === 'release'
          ? 'pending_acceptance'
          : action === 'accept'
            ? 'accepted'
            : action === 'decline'
              ? 'declined'
              : 'withdrawn';
      const [updated] = await tx<Transfer[]>`
        UPDATE clinical.consultant_care_transfers SET status = ${status},
          released_at = CASE WHEN ${action} = 'release' THEN now() ELSE released_at END,
          resolved_at = CASE WHEN ${action} <> 'release' THEN now() ELSE resolved_at END,
          resolution_reason = ${reason}
        WHERE id = ${id} RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${action}, 'clinical.consultant_care_transfers', ${id}, ${tx.json(updated as unknown as Json)})`;
      const recipient = action === 'release' ? current.to_consultant_id : current.requested_by;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
        INSERT INTO clinical.notifications (user_id, type, payload)
        VALUES (${recipient}, ${`care_transfer.${status}`}, ${tx.json({ transfer_id: id, admission_id: current.admission_id })}) RETURNING *
      `;
      await tx`SELECT pg_notify(${notifChannel(recipient)}, ${JSON.stringify(notification)})`;
      if (action === 'accept') {
        await tx`
          INSERT INTO clinical.notifications (user_id, type, payload)
          SELECT u.id, 'care_transfer.insurance_review', ${tx.json({ transfer_id: id, admission_id: current.admission_id })}
          FROM staff.users u
          WHERE u.job_role = 'billing_insurance' AND u.disabled_at IS NULL
            AND EXISTS (SELECT 1 FROM clinical.patient_coverage pc JOIN clinical.admissions a ON a.patient_id = pc.patient_id WHERE a.id = ${current.admission_id})
        `;
      }
      return updated;
    })
    .catch(rethrowDatabaseError);
}
