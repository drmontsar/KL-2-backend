import {
  CreateBodyInput,
  OpinionBodyInput,
  RecommendationOrderBodyInput,
} from '../../contracts/cross_referrals';

type Referral = {
  id: string;
  admission_id: string;
  requested_by: string;
  consultant_id: string;
  specialty: string;
  urgency: 'routine' | 'urgent' | 'emergency';
  question: string;
  findings: string;
  status: 'sent' | 'seen' | 'opinion' | 'acknowledged' | 'closed' | 'withdrawn';
  impression: string | null;
  recommendations: string | null;
  call_again: string | null;
  created_at: Date;
  seen_at: Date | null;
  opinion_at: Date | null;
  opinion_note_id: string | null;
  acknowledged_by: string | null;
  acknowledged_at: Date | null;
  closed_at: Date | null;
};
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';
import type { Order } from './orders';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function listCrossReferrals(
  query: {
    admission_id?: string | undefined;
    status?: 'withdrawn' | 'sent' | 'seen' | 'opinion' | 'acknowledged' | 'closed' | undefined;
  },
  user: User,
) {
  return db<Referral[]>`
    SELECT r.* FROM clinical.cross_referrals r
    WHERE (${query.admission_id ?? null}::uuid IS NULL OR r.admission_id = ${query.admission_id ?? null}::uuid)
      AND (${query.status ?? null}::text IS NULL OR r.status = ${query.status ?? null}::text)
      AND (${user.job_role === 'administrator' || user.job_role === 'duty_doctor'} OR r.consultant_id = ${user.id} OR r.requested_by = ${user.id}
        OR EXISTS (SELECT 1 FROM clinical.staff_assignments s WHERE s.admission_id = r.admission_id AND s.user_id = ${user.id} AND s.ends_at IS NULL))
    ORDER BY r.created_at DESC LIMIT 100
  `.catch(rethrowDatabaseError);
}

export async function createCrossReferral(actor_user_id: string, body: CreateBodyInput) {
  return db
    .begin(async (tx) => {
      const [referral] = await tx<Referral[]>`
        INSERT INTO clinical.cross_referrals (admission_id, requested_by, consultant_id, specialty, urgency, question, findings)
        SELECT a.id, ${actor_user_id}, u.id, ${body.specialty}, ${body.urgency}, ${body.question}, ${body.findings}
        FROM clinical.admissions a JOIN staff.users u ON u.id = ${body.consultant_id}
        WHERE a.id = ${body.admission_id} AND a.status = 'active' AND u.job_role = 'consultant' AND u.disabled_at IS NULL
        RETURNING *
      `;
      if (!referral) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'send', 'clinical.cross_referrals', ${referral.id}, ${tx.json(referral as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
        INSERT INTO clinical.notifications (user_id, type, payload)
        VALUES (${body.consultant_id}, 'referral.sent', ${tx.json({ referral_id: referral.id, admission_id: body.admission_id })}) RETURNING *
      `;
      await tx`SELECT pg_notify(${notifChannel(body.consultant_id)}, ${JSON.stringify(notification)})`;
      return referral;
    })
    .catch(rethrowDatabaseError);
}

export async function markReferralSeen(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [updated] = await tx<
        Referral[]
      >`UPDATE clinical.cross_referrals SET status = 'seen', seen_at = now() WHERE id = ${id} AND consultant_id = ${actor_user_id} AND status = 'sent' RETURNING *`;
      if (updated)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'seen', 'clinical.cross_referrals', ${id}, ${tx.json(updated as unknown as Json)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export async function recordReferralOpinion(
  body: OpinionBodyInput,
  id: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [updated] = await tx<Referral[]>`
      UPDATE clinical.cross_referrals SET status = 'opinion', impression = ${body.impression}, recommendations = ${body.recommendations},
        call_again = ${body.call_again ?? null}, seen_at = COALESCE(seen_at, now()), opinion_at = now()
      WHERE id = ${id} AND consultant_id = ${actor_user_id} AND status IN ('sent','seen') RETURNING *
    `;
      if (!updated) return null;
      const noteBody = `Cross-referral opinion — ${updated.specialty}\nImpression: ${body.impression}\nRecommendations: ${body.recommendations}${body.call_again ? `\nCall again: ${body.call_again}` : ''}`;
      const [note] = await tx<{ id: string }[]>`
      INSERT INTO clinical.notes (admission_id, kind, draft_body, created_by)
      VALUES (${updated.admission_id}, 'cross_referral_opinion', ${noteBody}, ${actor_user_id}) RETURNING id
    `;
      const [version] = await tx<{ id: string }[]>`
      INSERT INTO clinical.note_versions (note_id, version_no, body, confirmed_by)
      VALUES (${note.id}, 1, ${noteBody}, ${actor_user_id}) RETURNING id
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'confirm', 'clinical.note_versions', ${version.id}, ${tx.json({ note_id: note.id, referral_id: id })})
    `;
      await tx`UPDATE clinical.cross_referrals SET opinion_note_id = ${note.id} WHERE id = ${id}`;
      updated.opinion_note_id = note.id;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'opinion', 'clinical.cross_referrals', ${id}, ${tx.json(updated as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`
      INSERT INTO clinical.notifications (user_id, type, payload)
      VALUES (${updated.requested_by}, 'referral.opinion', ${tx.json({ referral_id: id, admission_id: updated.admission_id })}) RETURNING *
    `;
      await tx`SELECT pg_notify(${notifChannel(updated.requested_by)}, ${JSON.stringify(notification)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export async function getCrossReferral(id: string) {
  return db<Referral[]>`SELECT * FROM clinical.cross_referrals WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function createReferralOrder(
  body: RecommendationOrderBodyInput,
  actor_user_id: string,
  id: string,
) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Order[]>`
      INSERT INTO clinical.orders (admission_id, kind, priority, payload, created_by, cross_referral_id)
      SELECT r.admission_id, ${body.kind}, ${body.priority}, ${tx.json(body.payload as Json)}, ${actor_user_id}, r.id
      FROM clinical.cross_referrals r JOIN clinical.admissions a ON a.id = r.admission_id
      WHERE r.id = ${id} AND r.status IN ('opinion','acknowledged') AND a.status = 'active'
      RETURNING *
    `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create_from_referral', 'clinical.orders', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function transitionCrossReferral(
  action: 'withdraw' | 'acknowledge' | 'close',
  actor_user_id: string,
  id: string,
) {
  return db
    .begin(async (tx) => {
      const [updated] =
        action === 'acknowledge'
          ? await tx<
              Referral[]
            >`UPDATE clinical.cross_referrals SET status = 'acknowledged', acknowledged_by = ${actor_user_id}, acknowledged_at = now() WHERE id = ${id} AND status = 'opinion' RETURNING *`
          : action === 'withdraw'
            ? await tx<
                Referral[]
              >`UPDATE clinical.cross_referrals SET status = 'withdrawn', closed_at = now() WHERE id = ${id} AND status IN ('sent','seen') RETURNING *`
            : await tx<
                Referral[]
              >`UPDATE clinical.cross_referrals SET status = 'closed', closed_at = now() WHERE id = ${id} AND status = 'acknowledged' RETURNING *`;
      if (updated)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${action}, 'clinical.cross_referrals', ${id}, ${tx.json(updated as unknown as Json)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}
