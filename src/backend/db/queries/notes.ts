import { db } from '../index';
import { auditLog } from './audit';

export type Note = {
  id: string;
  admission_id: string;
  kind: string;
  draft_body: string | null;
  revision: number;
  created_by: string;
  created_at: Date;
};

export type NoteVersion = {
  id: string;
  note_id: string;
  version_no: number;
  body: string;
  confirmed_by: string;
  confirmed_at: Date;
};

export type Amendment = {
  id: string;
  note_version_id: string;
  body: string;
  reason: string | null;
  created_by: string;
  created_at: Date;
};

export async function createNote(data: {
  admission_id: string;
  kind: string;
  draft_body?: string;
  created_by: string;
}): Promise<Note> {
  const [row] = await db<Note[]>`
    INSERT INTO clinical.notes (admission_id, kind, draft_body, created_by)
    VALUES (${data.admission_id}, ${data.kind}, ${data.draft_body ?? null}, ${data.created_by})
    RETURNING *
  `;
  return row;
}

export async function updateNoteDraft(
  id: string,
  draft_body: string
): Promise<Note | null> {
  const [row] = await db<Note[]>`
    UPDATE clinical.notes
    SET draft_body = ${draft_body}, revision = revision + 1
    WHERE id = ${id}
    RETURNING *
  `;
  return row ?? null;
}

export function listNotesByAdmission(admission_id: string): Promise<Note[]> {
  return db<Note[]>`
    SELECT * FROM clinical.notes
    WHERE admission_id = ${admission_id}
    ORDER BY created_at DESC
  `;
}

// Confirms a draft — locks body into note_versions, next version_no auto-calculated
export async function confirmNote(data: {
  note_id: string;
  body: string;
  confirmed_by: string;
}): Promise<NoteVersion> {
  const [row] = await db<NoteVersion[]>`
    INSERT INTO clinical.note_versions (note_id, version_no, body, confirmed_by)
    VALUES (
      ${data.note_id},
      COALESCE((SELECT MAX(version_no) FROM clinical.note_versions WHERE note_id = ${data.note_id}), 0) + 1,
      ${data.body},
      ${data.confirmed_by}
    )
    RETURNING *
  `;
  await auditLog({
    action: 'confirm',
    record_table: 'clinical.note_versions',
    record_id: row.id,
    actor_user_id: data.confirmed_by,
    after: row,
  });
  return row;
}

export function listNoteVersions(note_id: string): Promise<NoteVersion[]> {
  return db<NoteVersion[]>`
    SELECT * FROM clinical.note_versions
    WHERE note_id = ${note_id}
    ORDER BY version_no
  `;
}

export async function addAmendment(data: {
  note_version_id: string;
  body: string;
  reason?: string;
  created_by: string;
}): Promise<Amendment> {
  const [row] = await db<Amendment[]>`
    INSERT INTO clinical.amendments (note_version_id, body, reason, created_by)
    VALUES (${data.note_version_id}, ${data.body}, ${data.reason ?? null}, ${data.created_by})
    RETURNING *
  `;
  return row;
}
