import { db } from '../index';
import { auditLog } from './audit';

export type HandoverSession = {
  id: string;
  outgoing_doctor_id: string;
  incoming_doctor_id: string;
  ward: string | null;
  status: 'active' | 'completed';
  created_at: Date;
  completed_at: Date | null;
};

export type HandoverItemSnapshot = {
  patient_name: string;
  patient_dob: string;
  ward: string | null;
  bed: string | null;
  severity: 'unstable' | 'watcher' | 'stable';
  diagnoses: string[];
  contingencies: string[];
  shift_events: { body: string; logged_at: string }[];
  latest_note: string | null;
};

export type HandoverItem = {
  id: string;
  session_id: string;
  admission_id: string;
  snapshot: HandoverItemSnapshot;
  item_version: number;
  created_at: Date;
};

export type HandoverAcknowledgment = {
  id: string;
  item_id: string;
  item_version: number;
  acknowledged_by: string;
  notes: string | null;
  acknowledged_at: Date;
};

export type HandoverItemWithAck = HandoverItem & {
  acknowledgment: HandoverAcknowledgment | null;
  stale: boolean; // true when admission.revision > item_version
};

export type HandoverSessionDetail = HandoverSession & {
  items: HandoverItemWithAck[];
};

// Creates a handover session and snapshots all active admissions for the outgoing doctor.
// Optionally filtered to a specific ward.
export async function createHandoverSession(data: {
  outgoing_doctor_id: string;
  incoming_doctor_id: string;
  ward?: string;
}): Promise<HandoverSessionDetail | 'no_patients' | 'bad_incoming'> {
  const [incoming] = await db`
    SELECT id FROM staff.users
    WHERE id = ${data.incoming_doctor_id} AND role = 'doctor' AND disabled_at IS NULL
  `;
  if (!incoming) return 'bad_incoming';

  // Build snapshots for all active admissions owned by outgoing doctor
  const snapshots = data.ward
    ? await db`
        SELECT
          a.id            AS admission_id,
          a.revision      AS item_version,
          a.severity,
          a.ward,
          a.bed,
          p.name          AS patient_name,
          p.dob           AS patient_dob,
          COALESCE((
            SELECT json_agg(d.description)
            FROM clinical.diagnoses d
            WHERE d.admission_id = a.id AND d.status = 'active'
          ), '[]'::json)  AS diagnoses,
          COALESCE((
            SELECT json_agg(c.body)
            FROM clinical.contingencies c
            WHERE c.admission_id = a.id
          ), '[]'::json)  AS contingencies,
          COALESCE((
            SELECT json_agg(json_build_object('body', se.body, 'logged_at', se.logged_at) ORDER BY se.logged_at DESC)
            FROM clinical.shift_events se
            WHERE se.admission_id = a.id AND se.logged_at > now() - interval '24 hours'
          ), '[]'::json)  AS shift_events,
          (SELECT n.draft_body FROM clinical.notes n WHERE n.admission_id = a.id ORDER BY n.created_at DESC LIMIT 1) AS latest_note
        FROM clinical.admissions a
        JOIN clinical.patients p ON p.id = a.patient_id
        WHERE a.assigned_doctor_id = ${data.outgoing_doctor_id}
          AND a.status = 'active'
          AND a.ward = ${data.ward}
        ORDER BY CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END, a.admitted_at
      `
    : await db`
        SELECT
          a.id            AS admission_id,
          a.revision      AS item_version,
          a.severity,
          a.ward,
          a.bed,
          p.name          AS patient_name,
          p.dob           AS patient_dob,
          COALESCE((
            SELECT json_agg(d.description)
            FROM clinical.diagnoses d
            WHERE d.admission_id = a.id AND d.status = 'active'
          ), '[]'::json)  AS diagnoses,
          COALESCE((
            SELECT json_agg(c.body)
            FROM clinical.contingencies c
            WHERE c.admission_id = a.id
          ), '[]'::json)  AS contingencies,
          COALESCE((
            SELECT json_agg(json_build_object('body', se.body, 'logged_at', se.logged_at) ORDER BY se.logged_at DESC)
            FROM clinical.shift_events se
            WHERE se.admission_id = a.id AND se.logged_at > now() - interval '24 hours'
          ), '[]'::json)  AS shift_events,
          (SELECT n.draft_body FROM clinical.notes n WHERE n.admission_id = a.id ORDER BY n.created_at DESC LIMIT 1) AS latest_note
        FROM clinical.admissions a
        JOIN clinical.patients p ON p.id = a.patient_id
        WHERE a.assigned_doctor_id = ${data.outgoing_doctor_id}
          AND a.status = 'active'
        ORDER BY CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END, a.admitted_at
      `;

  if (!snapshots.length) return 'no_patients';

  const [session] = await db<HandoverSession[]>`
    INSERT INTO clinical.handover_sessions (outgoing_doctor_id, incoming_doctor_id, ward)
    VALUES (${data.outgoing_doctor_id}, ${data.incoming_doctor_id}, ${data.ward ?? null})
    RETURNING *
  `;

  const items = await db<HandoverItem[]>`
    INSERT INTO clinical.handover_items (session_id, admission_id, snapshot, item_version)
    SELECT
      ${session.id},
      s.admission_id,
      json_build_object(
        'patient_name', s.patient_name,
        'patient_dob',  s.patient_dob,
        'ward',         s.ward,
        'bed',          s.bed,
        'severity',     s.severity,
        'diagnoses',    s.diagnoses,
        'contingencies',s.contingencies,
        'shift_events', s.shift_events,
        'latest_note',  s.latest_note
      )::jsonb,
      s.item_version
    FROM jsonb_to_recordset(${db.json(snapshots)}::jsonb) AS s(
      admission_id uuid, item_version int,
      severity text, ward text, bed text,
      patient_name text, patient_dob text,
      diagnoses jsonb, contingencies jsonb, shift_events jsonb, latest_note text
    )
    RETURNING *
  `;

  await auditLog({
    action: 'create',
    record_table: 'clinical.handover_sessions',
    record_id: session.id,
    actor_user_id: data.outgoing_doctor_id,
    after: { session_id: session.id, item_count: items.length },
  });

  return { ...session, items: items.map((i) => ({ ...i, acknowledgment: null, stale: false })) };
}

export async function getHandoverSession(id: string): Promise<HandoverSessionDetail | null> {
  const [session] = await db<HandoverSession[]>`
    SELECT * FROM clinical.handover_sessions WHERE id = ${id}
  `;
  if (!session) return null;

  const rows = await db`
    SELECT
      hi.*,
      ha.id              AS ack_id,
      ha.item_version    AS ack_version,
      ha.acknowledged_by AS ack_by,
      ha.notes           AS ack_notes,
      ha.acknowledged_at AS ack_at,
      a.revision         AS current_revision
    FROM clinical.handover_items hi
    JOIN clinical.admissions a ON a.id = hi.admission_id
    LEFT JOIN clinical.handover_acknowledgments ha ON ha.item_id = hi.id
    WHERE hi.session_id = ${id}
    ORDER BY (hi.snapshot->>'severity' = 'unstable') DESC,
             (hi.snapshot->>'severity' = 'watcher')  DESC,
             hi.created_at
  `;

  const items: HandoverItemWithAck[] = rows.map((r) => ({
    id: r.id,
    session_id: r.session_id,
    admission_id: r.admission_id,
    snapshot: r.snapshot as HandoverItemSnapshot,
    item_version: r.item_version,
    created_at: r.created_at,
    acknowledgment: r.ack_id
      ? {
          id: r.ack_id,
          item_id: r.id,
          item_version: r.ack_version,
          acknowledged_by: r.ack_by,
          notes: r.ack_notes,
          acknowledged_at: r.ack_at,
        }
      : null,
    stale: r.current_revision > r.item_version,
  }));

  return { ...session, items };
}

export function listHandoverSessions(
  doctor_id: string,
  role: 'outgoing' | 'incoming' | 'all' = 'all'
): Promise<HandoverSession[]> {
  if (role === 'outgoing') {
    return db<HandoverSession[]>`
      SELECT * FROM clinical.handover_sessions
      WHERE outgoing_doctor_id = ${doctor_id}
      ORDER BY created_at DESC
    `;
  }
  if (role === 'incoming') {
    return db<HandoverSession[]>`
      SELECT * FROM clinical.handover_sessions
      WHERE incoming_doctor_id = ${doctor_id}
      ORDER BY created_at DESC
    `;
  }
  return db<HandoverSession[]>`
    SELECT * FROM clinical.handover_sessions
    WHERE outgoing_doctor_id = ${doctor_id} OR incoming_doctor_id = ${doctor_id}
    ORDER BY created_at DESC
  `;
}

// Incoming doctor acknowledges a handover item.
// Returns 'not_yours' if the session doesn't belong to this doctor.
export async function acknowledgeHandoverItem(
  item_id: string,
  acknowledged_by: string,
  notes?: string
): Promise<HandoverAcknowledgment | null | 'not_yours'> {
  const [item] = await db`
    SELECT hi.item_version, hs.incoming_doctor_id
    FROM clinical.handover_items hi
    JOIN clinical.handover_sessions hs ON hs.id = hi.session_id
    WHERE hi.id = ${item_id}
  `;
  if (!item) return null;
  if (item.incoming_doctor_id !== acknowledged_by) return 'not_yours';

  const [ack] = await db<HandoverAcknowledgment[]>`
    INSERT INTO clinical.handover_acknowledgments (item_id, item_version, acknowledged_by, notes)
    VALUES (${item_id}, ${item.item_version}, ${acknowledged_by}, ${notes ?? null})
    ON CONFLICT (item_id, acknowledged_by)
      DO UPDATE SET item_version = EXCLUDED.item_version, notes = EXCLUDED.notes, acknowledged_at = now()
    RETURNING *
  `;

  await auditLog({
    action: 'acknowledge',
    record_table: 'clinical.handover_items',
    record_id: item_id,
    actor_user_id: acknowledged_by,
    after: ack,
  });

  return ack;
}
