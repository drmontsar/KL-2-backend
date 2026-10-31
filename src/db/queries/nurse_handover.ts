import {
  AcceptBodyInput,
  CreateBodyInput,
  Item,
  Question,
  QuestionBodyInput,
  Session,
} from '../../contracts/nurse_handover';
import type { TransactionSql } from 'postgres';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';

type Json = Parameters<(typeof db)['json']>[0];

// Both snapshot readers use the admissions/patients aliases a and p below.
function nurseSnapshot(tx: TransactionSql) {
  return tx`jsonb_build_object(
            'severity', a.severity, 'allergies', p.allergies,
            'latest_observation', (SELECT to_jsonb(v) FROM clinical.vitals v WHERE v.admission_id = a.id ORDER BY v.recorded_at DESC, v.event_order DESC LIMIT 1),
            'latest_assessment', (SELECT to_jsonb(n) FROM clinical.nursing_assessments n WHERE n.admission_id = a.id ORDER BY n.assessed_at DESC LIMIT 1),
            'open_orders', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC) FROM clinical.orders o WHERE o.admission_id = a.id AND o.status IN ('draft','confirmed')), '[]'::jsonb),
            'medications', COALESCE((SELECT jsonb_agg(jsonb_build_object('schedule', to_jsonb(s), 'doses', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.due_at) FROM clinical.medication_doses d WHERE d.schedule_id = s.id AND (d.status = 'scheduled' OR d.acted_at >= now() - interval '24 hours')), '[]'::jsonb))) FROM clinical.medication_schedules s WHERE s.admission_id = a.id AND s.active), '[]'::jsonb),
            'infusions', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.recorded_at DESC) FROM clinical.infusion_events e JOIN clinical.medication_schedules s ON s.id = e.schedule_id WHERE s.admission_id = a.id AND e.recorded_at >= now() - interval '24 hours'), '[]'::jsonb),
            'nursing_tasks', COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.due_at) FROM clinical.nursing_recurring_tasks t WHERE t.admission_id = a.id AND t.status = 'active'), '[]'::jsonb),
            'fluid_balance', COALESCE((SELECT sum(CASE WHEN f.direction = 'intake' THEN f.volume_ml ELSE -f.volume_ml END) FROM clinical.fluid_entries f WHERE f.admission_id = a.id AND f.occurred_at >= now() - interval '24 hours'), 0)
          )`;
}

export async function getNursingHandoverSnapshot(tx: TransactionSql, admission_id: string) {
  const [row] = await tx<{ snapshot: Record<string, unknown> }[]>`
    SELECT ${nurseSnapshot(tx)} AS snapshot FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id WHERE a.id = ${admission_id}
  `;
  if (!row) throw new Error('Missing admission for nursing snapshot');
  return row.snapshot;
}

export async function createNurseHandover(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [incoming] =
        await tx`SELECT id FROM staff.users WHERE id = ${body.incoming_nurse_id} AND role = 'nurse' AND disabled_at IS NULL`;
      if (!incoming) return null;
      const admissions = await tx<{ id: string }[]>`
        SELECT id FROM clinical.admissions WHERE assigned_to = ${actor_user_id} AND status = 'active'
          AND (${body.ward ?? null}::text IS NULL OR ward = ${body.ward ?? null}::text) ORDER BY id FOR UPDATE
      `;
      if (!admissions.length) return null;
      const [session] = await tx<
        Session[]
      >`INSERT INTO clinical.nurse_handover_sessions (outgoing_nurse_id, incoming_nurse_id) VALUES (${actor_user_id}, ${body.incoming_nurse_id}) RETURNING *`;
      const ids = admissions.map((row) => row.id);
      const items = await tx<Item[]>`
        INSERT INTO clinical.nurse_handover_items (session_id, admission_id, patient_name, ward, bed, snapshot)
        SELECT ${session.id}, a.id, p.name, a.ward, a.bed,
          ${nurseSnapshot(tx)}
        FROM clinical.admissions a JOIN clinical.patients p ON p.id = a.patient_id WHERE a.id IN ${tx(ids)} RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'clinical.nurse_handover_sessions', ${session.id}, ${tx.json({ item_count: items.length })})`;
      return { session, items };
    })
    .catch(rethrowDatabaseError);
}

export async function listNurseHandovers(actor_user_id: string) {
  return db<
    Session[]
  >`SELECT * FROM clinical.nurse_handover_sessions WHERE outgoing_nurse_id = ${actor_user_id} OR incoming_nurse_id = ${actor_user_id} ORDER BY created_at DESC LIMIT 100`.catch(
    rethrowDatabaseError,
  );
}

export async function getNurseHandover(id: string, actor_user_id: string) {
  return db<
    Session[]
  >`SELECT * FROM clinical.nurse_handover_sessions WHERE id = ${id} AND (outgoing_nurse_id = ${actor_user_id} OR (incoming_nurse_id = ${actor_user_id} AND status IN ('sent','completed')))`.catch(
    rethrowDatabaseError,
  );
}

export async function listNurseHandoverItems(id: string) {
  return db<
    Item[]
  >`SELECT * FROM clinical.nurse_handover_items WHERE session_id = ${id} ORDER BY patient_name`.catch(
    rethrowDatabaseError,
  );
}

export async function getNurseHandoverItemOwner(id: string) {
  return db<
    { outgoing_nurse_id: string }[]
  >`SELECT s.outgoing_nurse_id FROM clinical.nurse_handover_sessions s JOIN clinical.nurse_handover_items i ON i.session_id = s.id WHERE i.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function updateNurseHandoverItem(
  handover_notes: string,
  id: string,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<
        Item[]
      >`UPDATE clinical.nurse_handover_items i SET handover_notes = ${handover_notes} FROM clinical.nurse_handover_sessions s WHERE i.id = ${id} AND s.id = i.session_id AND s.status = 'draft' AND s.outgoing_nurse_id = ${actor_user_id} AND i.status = 'draft' RETURNING i.*`;
      if (item)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'update', 'clinical.nurse_handover_items', ${id}, ${tx.json(item as unknown as Json)})`;
      return item;
    })
    .catch(rethrowDatabaseError);
}

export async function getNurseHandoverById(id: string) {
  return db<Session[]>`SELECT * FROM clinical.nurse_handover_sessions WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function sendNurseHandover(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`SELECT * FROM clinical.nurse_handover_sessions WHERE id = ${id} AND status = 'draft' FOR UPDATE`;
      if (!session) return null;
      const [invalid] =
        await tx`SELECT i.id FROM clinical.nurse_handover_items i JOIN clinical.admissions a ON a.id = i.admission_id WHERE i.session_id = ${id} AND (a.status <> 'active' OR a.assigned_to IS DISTINCT FROM ${actor_user_id}::uuid) LIMIT 1`;
      if (invalid) return null;
      const [row] = await tx<
        Session[]
      >`UPDATE clinical.nurse_handover_sessions SET status = 'sent', sent_at = now() WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'send', 'clinical.nurse_handover_sessions', ${id}, ${tx.json(row as unknown as Json)})`;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${row.incoming_nurse_id}, 'nurse_handover.sent', ${tx.json({ session_id: id })}) RETURNING *`;
      await tx`SELECT pg_notify(${notifChannel(row.incoming_nurse_id)}, ${JSON.stringify(notification)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function getNurseHandoverItemRecipient(id: string) {
  return db<
    { incoming_nurse_id: string }[]
  >`SELECT s.incoming_nurse_id FROM clinical.nurse_handover_sessions s JOIN clinical.nurse_handover_items i ON i.session_id = s.id WHERE i.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function acceptNurseHandoverItem(
  id: string,
  actor_user_id: string,
  body: AcceptBodyInput,
) {
  return db
    .begin(async (tx) => {
      const [item] = await tx<(Item & { outgoing_nurse_id: string })[]>`
      SELECT i.*, s.outgoing_nurse_id FROM clinical.nurse_handover_items i JOIN clinical.nurse_handover_sessions s ON s.id = i.session_id
      WHERE i.id = ${id} AND s.incoming_nurse_id = ${actor_user_id} AND s.status = 'sent' AND i.status = 'draft' FOR UPDATE OF i, s
    `;
      if (!item) return null;
      const [admission] = await tx`
      UPDATE clinical.admissions SET assigned_to = ${actor_user_id}, revision = revision + 1
      WHERE id = ${item.admission_id} AND status = 'active' AND assigned_to = ${item.outgoing_nurse_id} RETURNING id
    `;
      if (!admission) return null;
      await tx`UPDATE clinical.staff_assignments SET ends_at = now() WHERE admission_id = ${item.admission_id} AND user_id = ${item.outgoing_nurse_id} AND assignment_type = 'primary_nurse' AND ends_at IS NULL`;
      await tx`INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by) VALUES (${item.admission_id}, ${actor_user_id}, 'primary_nurse', ${actor_user_id}) ON CONFLICT DO NOTHING`;
      const [updated] = await tx<
        Item[]
      >`UPDATE clinical.nurse_handover_items SET status = 'accepted', checklist = ${tx.json(body.checklist)}, discrepancies = ${body.discrepancies ?? null}, accepted_at = now() WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'accept', 'clinical.nurse_handover_items', ${id}, ${tx.json(updated as unknown as Json)})`;
      const [remaining] =
        await tx`SELECT id FROM clinical.nurse_handover_items WHERE session_id = ${item.session_id} AND status <> 'accepted' LIMIT 1`;
      if (!remaining) {
        await tx`UPDATE clinical.nurse_handover_sessions SET status = 'completed', completed_at = now() WHERE id = ${item.session_id}`;
        await tx`UPDATE staff.shifts SET status = 'completed' WHERE user_id = ${item.outgoing_nurse_id} AND status = 'active' AND NOT EXISTS (SELECT 1 FROM clinical.admissions WHERE status = 'active' AND assigned_to = ${item.outgoing_nurse_id})`;
      }
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${item.outgoing_nurse_id}, 'nurse_handover.accepted', ${tx.json({ session_id: item.session_id, item_id: id, admission_id: item.admission_id })}) RETURNING *`;
      await tx`SELECT pg_notify(${notifChannel(item.outgoing_nurse_id)}, ${JSON.stringify(notification)})`;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export async function getNurseHandoverForItem(id: string) {
  return db<
    Session[]
  >`SELECT s.* FROM clinical.nurse_handover_sessions s JOIN clinical.nurse_handover_items i ON i.session_id = s.id WHERE i.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function addNurseHandoverQuestion(
  id: string,
  actor_user_id: string,
  body: QuestionBodyInput,
) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`SELECT s.* FROM clinical.nurse_handover_sessions s JOIN clinical.nurse_handover_items i ON i.session_id = s.id
      WHERE i.id = ${id} AND s.status = 'sent' AND (s.outgoing_nurse_id = ${actor_user_id} OR s.incoming_nurse_id = ${actor_user_id}) FOR UPDATE OF s`;
      if (!session) return null;
      const [question] = await tx<
        Question[]
      >`INSERT INTO clinical.nurse_handover_questions (item_id, author_id, body) VALUES (${id}, ${actor_user_id}, ${body.body}) RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'question', 'clinical.nurse_handover_questions', ${question.id}, ${tx.json(question as unknown as Json)})`;
      const recipient =
        actor_user_id === session.outgoing_nurse_id
          ? session.incoming_nurse_id
          : session.outgoing_nurse_id;
      const [notification] = await tx<
        { id: string; type: string; payload: Json; created_at: Date }[]
      >`INSERT INTO clinical.notifications (user_id, type, payload) VALUES (${recipient}, 'nurse_handover.question', ${tx.json({ session_id: session.id, item_id: id })}) RETURNING *`;
      await tx`SELECT pg_notify(${notifChannel(recipient)}, ${JSON.stringify(notification)})`;
      return question;
    })
    .catch(rethrowDatabaseError);
}

export async function listNurseHandoverQuestions(id: string) {
  return db<
    Question[]
  >`SELECT * FROM clinical.nurse_handover_questions WHERE item_id = ${id} ORDER BY created_at`.catch(
    rethrowDatabaseError,
  );
}

export async function cancelNurseHandover(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [session] = await tx<
        Session[]
      >`UPDATE clinical.nurse_handover_sessions SET status = 'cancelled', completed_at = now() WHERE id = ${id} AND status IN ('draft','sent') RETURNING *`;
      if (!session) return null;
      await tx`UPDATE clinical.nurse_handover_items SET status = 'cancelled' WHERE session_id = ${id} AND status = 'draft'`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'cancel', 'clinical.nurse_handover_sessions', ${id}, ${tx.json(session as unknown as Json)})`;
      return session;
    })
    .catch(rethrowDatabaseError);
}
