import {
  CreateBodyInput,
  Item,
  ItemBodyInput,
  Question,
  QuestionBodyInput,
  Session,
} from '../../contracts/ipass';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';

type Json = Parameters<(typeof db)['json']>[0];

export async function createIpassSession(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const admissions = await tx<{ id: string }[]>`
        SELECT id FROM clinical.admissions WHERE status = 'active'
          AND (${body.ward ?? null}::text IS NULL OR ward = ${body.ward ?? null}::text) ORDER BY id FOR UPDATE
      `;
      if (!admissions.length) return null;
      const [session] = await tx<
        Session[]
      >`INSERT INTO clinical.ipass_sessions (outgoing_doctor_id, ward) VALUES (${actor_user_id}, ${body.ward ?? null}) RETURNING *`;
      const ids = admissions.map((row) => row.id);
      const items = await tx<Item[]>`
        INSERT INTO clinical.ipass_items (session_id, admission_id, patient_name, ward, bed, severity, arrival_status, snapshot_revision)
        SELECT ${session.id}, a.id, p.name, a.ward, a.bed, a.severity, a.arrival_status, a.revision
        FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id WHERE a.id IN ${tx(ids)} RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'clinical.ipass_sessions', ${session.id}, ${tx.json({ item_count: items.length })})`;
      return { session, items };
    })
    .catch(rethrowDatabaseError);
}

export async function listIpassSessions(actor_user_id: string) {
  return db<
    Session[]
  >`SELECT * FROM clinical.ipass_sessions WHERE outgoing_doctor_id = ${actor_user_id} OR status IN ('sent', 'completed')
    ORDER BY CASE WHEN status = 'sent' THEN 0 WHEN status = 'draft' THEN 1 ELSE 2 END, created_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getIpassSession(id: string, actor_user_id: string) {
  return db<
    Session[]
  >`SELECT * FROM clinical.ipass_sessions WHERE id = ${id} AND (outgoing_doctor_id = ${actor_user_id} OR status IN ('sent','completed'))`.catch(
    rethrowDatabaseError,
  );
}

export async function listIpassItems(id: string) {
  return db<
    Item[]
  >`SELECT * FROM clinical.ipass_items WHERE session_id = ${id} ORDER BY CASE severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END, patient_name`.catch(
    rethrowDatabaseError,
  );
}

export async function getOutgoingIpassItemOwner(id: string) {
  return db<
    { outgoing_doctor_id: string }[]
  >`SELECT s.outgoing_doctor_id FROM clinical.ipass_sessions s JOIN clinical.ipass_items i ON i.session_id = s.id WHERE i.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function updateIpassItem(body: ItemBodyInput, id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<Item[]>`
      UPDATE clinical.ipass_items i SET patient_summary = ${body.patient_summary}, action_list = ${body.action_list}, contingency = ${body.contingency},
        severity = a.severity, arrival_status = a.arrival_status, snapshot_revision = a.revision, ward = a.ward, bed = a.bed, status = 'draft', signed_at = NULL
      FROM clinical.ipass_sessions s, clinical.admissions a
      WHERE i.id = ${id} AND s.id = i.session_id AND s.status = 'draft' AND s.outgoing_doctor_id = ${actor_user_id}
        AND a.id = i.admission_id AND a.status = 'active' RETURNING i.*
    `;
      if (item)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'update', 'clinical.ipass_items', ${id}, ${tx.json(item as unknown as Json)})`;
      return item;
    })
    .catch(rethrowDatabaseError);
}

export async function signIpassItem(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<Item[]>`
      UPDATE clinical.ipass_items i SET status = 'signed', signed_at = now()
      FROM clinical.ipass_sessions s, clinical.admissions a
      WHERE i.id = ${id} AND s.id = i.session_id AND s.status = 'draft' AND s.outgoing_doctor_id = ${actor_user_id}
        AND i.status = 'draft' AND a.id = i.admission_id AND a.status = 'active' AND a.arrival_status = i.arrival_status
        AND a.revision = i.snapshot_revision AND length(trim(i.patient_summary)) > 0 AND length(trim(i.action_list)) > 0 AND length(trim(i.contingency)) > 0 RETURNING i.*
    `;
      if (item)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'sign', 'clinical.ipass_items', ${id}, ${tx.json(item as unknown as Json)})`;
      return item;
    })
    .catch(rethrowDatabaseError);
}

export async function getIpassSessionById(id: string) {
  return db<Session[]>`SELECT * FROM clinical.ipass_sessions WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function sendIpassSession(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`SELECT * FROM clinical.ipass_sessions WHERE id = ${id} AND status = 'draft' AND outgoing_doctor_id = ${actor_user_id} FOR UPDATE`;
      if (!session) return null;
      const [invalid] = await tx`
      SELECT i.id FROM clinical.ipass_items i JOIN clinical.admissions a ON a.id = i.admission_id
      WHERE i.session_id = ${id} AND (i.status <> 'signed' OR a.status <> 'active' OR a.arrival_status <> i.arrival_status OR a.revision <> i.snapshot_revision)
      LIMIT 1
    `;
      if (invalid) return null;
      const [row] = await tx<
        Session[]
      >`UPDATE clinical.ipass_sessions SET status = 'sent', sent_at = now() WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'send', 'clinical.ipass_sessions', ${id}, ${tx.json(row as unknown as Json)})`;
      const notifications = await tx<
        { user_id: string; id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload)
        SELECT u.id, 'ipass.sent', ${tx.json({ session_id: id })} FROM staff.users u
        WHERE u.job_role = 'duty_doctor' AND u.disabled_at IS NULL AND u.id <> ${actor_user_id}
        RETURNING *`;
      for (const notification of notifications)
        await tx`SELECT pg_notify(${notifChannel(notification.user_id)}, ${JSON.stringify(notification)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function acceptIpassItem(
  id: string,
  actor_user_id: string,
  receiver_view: string,
  readback: string | undefined,
  acknowledge_stale = false,
) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<(Item & { outgoing_doctor_id: string })[]>`
      SELECT i.*, s.outgoing_doctor_id FROM clinical.ipass_items i JOIN clinical.ipass_sessions s ON s.id = i.session_id
      WHERE i.id = ${id} AND s.outgoing_doctor_id <> ${actor_user_id} AND s.status = 'sent' AND i.status = 'signed' FOR UPDATE OF i, s
    `;
      if (!item || !receiver_view.trim() || (item.severity !== 'stable' && !readback?.trim())) return null;
      const [admission] = await tx<{ id: string; revision: string; arrival_status: string }[]>`
        SELECT id, revision, arrival_status FROM clinical.admissions
        WHERE id = ${item.admission_id} AND status = 'active' FOR UPDATE
      `;
      if (!admission) return null;
      const [changes] = await tx<{ changed: boolean }[]>`
        SELECT (${admission.revision}::bigint <> ${item.snapshot_revision}::bigint
          OR ${admission.arrival_status} <> ${item.arrival_status}
          OR EXISTS (SELECT 1 FROM clinical.vitals v WHERE v.admission_id = ${item.admission_id} AND v.recorded_at > ${item.signed_at}::timestamptz)
          OR EXISTS (SELECT 1 FROM clinical.notes n WHERE n.admission_id = ${item.admission_id} AND n.created_at > ${item.signed_at}::timestamptz)
          OR EXISTS (SELECT 1 FROM clinical.orders o WHERE o.admission_id = ${item.admission_id} AND (o.created_at > ${item.signed_at}::timestamptz OR o.confirmed_at > ${item.signed_at}::timestamptz))
          OR EXISTS (SELECT 1 FROM clinical.initial_assessments ia WHERE ia.admission_id = ${item.admission_id} AND ia.signed_at > ${item.signed_at}::timestamptz)
        ) AS changed
      `;
      if (changes.changed && !acknowledge_stale) return null;
      const [updated] = await tx<
        Item[]
      >`UPDATE clinical.ipass_items SET status = 'accepted', readback = ${readback ?? null},
        receiver_view = ${receiver_view}, reviewed_by = ${actor_user_id}, stale_acknowledged = ${changes.changed}, accepted_at = now()
        WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'accept', 'clinical.ipass_items', ${id}, ${tx.json(updated as unknown as Json)})`;
      const [remaining] =
        await tx`SELECT id FROM clinical.ipass_items WHERE session_id = ${item.session_id} AND status <> 'accepted' LIMIT 1`;
      if (!remaining) {
        await tx`UPDATE clinical.ipass_sessions SET status = 'completed', completed_at = now() WHERE id = ${item.session_id}`;
      }
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${item.outgoing_doctor_id}, 'ipass.accepted', ${tx.json({ session_id: item.session_id, item_id: id, admission_id: item.admission_id })}) RETURNING *`;
      await tx`SELECT pg_notify(${notifChannel(item.outgoing_doctor_id)}, ${JSON.stringify(notification)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export async function getIpassSessionForItem(id: string) {
  return db<
    Session[]
  >`SELECT s.* FROM clinical.ipass_sessions s JOIN clinical.ipass_items i ON i.session_id = s.id WHERE i.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function addIpassQuestion(id: string, actor_user_id: string, body: QuestionBodyInput) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`SELECT s.* FROM clinical.ipass_sessions s JOIN clinical.ipass_items i ON i.session_id = s.id
      WHERE i.id = ${id} AND s.status = 'sent' FOR UPDATE OF s`;
      if (!session) return null;
      const [row] = await tx<
        Question[]
      >`INSERT INTO clinical.ipass_questions (item_id, author_id, body) VALUES (${id}, ${actor_user_id}, ${body.body}) RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'question', 'clinical.ipass_questions', ${row.id}, ${tx.json(row as unknown as Json)})`;
      const [lastReviewer] = await tx<{ author_id: string }[]>`
        SELECT author_id FROM clinical.ipass_questions
        WHERE item_id = ${id} AND author_id <> ${session.outgoing_doctor_id}
        ORDER BY created_at DESC LIMIT 1
      `;
      const recipient = actor_user_id === session.outgoing_doctor_id
        ? lastReviewer?.author_id : session.outgoing_doctor_id;
      if (recipient && recipient !== actor_user_id) {
        const [notification] = await tx<{ id: string; type: string; payload: Json; created_at: Date }[]>`
          INSERT INTO clinical.notifications (user_id, type, payload)
          VALUES (${recipient}, 'ipass.question', ${tx.json({ session_id: session.id, item_id: id })}) RETURNING *
        `;
        await tx`SELECT pg_notify(${notifChannel(recipient)}, ${JSON.stringify(notification)})`;
      }
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function refreshIpassItem(body: ItemBodyInput, id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<Item[]>`
      UPDATE clinical.ipass_items i SET patient_summary = ${body.patient_summary}, action_list = ${body.action_list}, contingency = ${body.contingency},
        severity = a.severity, arrival_status = a.arrival_status, snapshot_revision = a.revision, ward = a.ward, bed = a.bed, signed_at = now()
      FROM clinical.ipass_sessions s, clinical.admissions a
      WHERE i.id = ${id} AND s.id = i.session_id AND s.status = 'sent' AND s.outgoing_doctor_id = ${actor_user_id} AND i.status = 'signed'
        AND a.id = i.admission_id AND a.status = 'active'
      RETURNING i.*
    `;
      if (!item) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'refresh', 'clinical.ipass_items', ${id}, ${tx.json(item as unknown as Json)})`;
      const notifications = await tx<
        { user_id: string; id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload)
        SELECT u.id, 'ipass.refreshed', ${tx.json({ session_id: item.session_id, item_id: id })}
        FROM staff.users u WHERE u.job_role = 'duty_doctor' AND u.disabled_at IS NULL AND u.id <> ${actor_user_id}
        RETURNING *`;
      for (const notification of notifications)
        await tx`SELECT pg_notify(${notifChannel(notification.user_id)}, ${JSON.stringify(notification)})`;
      return item;
    })
    .catch(rethrowDatabaseError);
}

export async function listIpassQuestions(id: string) {
  return db<
    Question[]
  >`SELECT * FROM clinical.ipass_questions WHERE item_id = ${id} ORDER BY created_at`.catch(
    rethrowDatabaseError,
  );
}

export async function cancelIpassSession(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`UPDATE clinical.ipass_sessions SET status = 'cancelled', completed_at = now() WHERE id = ${id} AND status IN ('draft','sent') RETURNING *`;
      if (!session) return null;
      await tx`UPDATE clinical.ipass_items SET status = 'cancelled' WHERE session_id = ${id} AND status IN ('draft','signed')`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'cancel', 'clinical.ipass_sessions', ${id}, ${tx.json(session as unknown as Json)})`;
      return session;
    })
    .catch(rethrowDatabaseError);
}
