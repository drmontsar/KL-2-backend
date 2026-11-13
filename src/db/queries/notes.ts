import { DomainError } from '../../errors';
import type { z } from 'zod';
import { ClinicalContextSchema } from '../../contracts/common';
import type { Diagnosis } from './diagnoses';

import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
type Json = Parameters<(typeof db)['json']>[0];
import { auditLog } from './audit';

type Transaction = Parameters<typeof auditLog>[0];
type ClinicalContext = z.infer<typeof ClinicalContextSchema>;
async function stamp(tx: Transaction, id: string) {
  const [row] = await tx`SELECT jsonb_build_object('user_id', id, 'name', name, 'designation', replace(job_role::text, '_', ' '), 'registration_number', registration_number) AS value FROM staff.users WHERE id = ${id}`;
  return row?.value ?? null;
}
async function applyDiagnoses(tx: Transaction, admission_id: string, context: ClinicalContext | null | undefined, actor: string) {
  const [admission] = await tx`SELECT patient_id FROM clinical.admissions WHERE id = ${admission_id}`;
  for (const description of new Set(context?.provisional_diagnoses ?? [])) {
    const [existing] = await tx`SELECT id FROM clinical.diagnoses WHERE patient_id = ${admission.patient_id} AND admission_id = ${admission_id} AND status = 'active' AND lower(trim(description)) = lower(${description})`;
    if (existing) continue;
    const [diagnosis] = await tx<Diagnosis[]>`INSERT INTO clinical.diagnoses (patient_id, admission_id, description, created_by) VALUES (${admission.patient_id}, ${admission_id}, ${description}, ${actor}) RETURNING *`;
    await auditLog(tx, { actor_user_id: actor, action: 'create', record_table: 'clinical.diagnoses', record_id: diagnosis.id, after: diagnosis });
  }
}

export type Note = {
  id: string;
  admission_id: string;
  kind: string;
  draft_body: string | null;
  clinical_context: z.infer<typeof ClinicalContextSchema> | null;
  revision: number;
  created_by: string;
  created_at: Date;
  documentation_status: 'draft' | 'saved';
  saved_at: Date | null;
  updated_at: Date;
  author_stamp: {user_id: string; name: string; designation: string; registration_number: string | null} | null;
};

function serializeNote(note: Note): Note { return {...note, revision: Number(note.revision)}; }

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
  clinical_context?: z.infer<typeof ClinicalContextSchema>;
  documentation_status?: 'draft' | 'saved';
  created_by: string;
}): Promise<Note> {
  return db
    .begin(async (tx) => {
      const [admission] = await tx`SELECT id, patient_id FROM clinical.admissions WHERE id = ${data.admission_id} FOR UPDATE`;
      if (!admission) throw new DomainError('conflict');
      const status = data.documentation_status ?? 'saved';
      if (status === 'saved' && !ClinicalContextSchema.safeParse(data.clinical_context ?? {}).success) throw new DomainError('conflict');
      const author = status === 'saved' ? await stamp(tx, data.created_by) : null;
      const [row] = await tx<Note[]>`
      INSERT INTO clinical.notes (admission_id, kind, draft_body, clinical_context, created_by, documentation_status, saved_at, author_stamp)
      VALUES (${data.admission_id}, ${data.kind}, ${data.draft_body ?? null}, ${data.clinical_context ? tx.json(data.clinical_context as Json) : null}, ${data.created_by}, ${status}, ${status === 'saved' ? tx`now()` : null}, ${author ? tx.json(author) : null}) RETURNING *
    `;
      if (status === 'saved') await applyDiagnoses(tx, data.admission_id, data.clinical_context, data.created_by);
      await auditLog(tx, {
        actor_user_id: data.created_by,
        action: 'create',
        record_table: 'clinical.notes',
        record_id: row.id,
        after: row,
      });
      return serializeNote(row);
    })
    .catch(rethrowDatabaseError);
}

export async function updateNoteDraft(
  id: string,
  draft_body: string,
  expected_revision: number,
  actor_user_id: string,
  admission_id?: string,
  changes?: {clinical_context?: ClinicalContext; documentation_status?: 'draft' | 'saved'},
): Promise<Note | null> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.admissions WHERE id = (SELECT admission_id FROM clinical.notes WHERE id = ${id}) FOR UPDATE`;
      const [note] = await tx<Note[]>`SELECT * FROM clinical.notes
      WHERE id = ${id} AND (${admission_id ?? null}::uuid IS NULL OR admission_id = ${admission_id ?? null}) FOR UPDATE`;
      if (!note) return null;
      if (note.documentation_status === 'draft' && note.created_by !== actor_user_id) return null;
      if (changes?.documentation_status && note.documentation_status !== 'draft') return null;
      if (Number(note.revision) !== expected_revision) throw new DomainError('conflict');
      const status = changes?.documentation_status ?? note.documentation_status;
      const context = changes?.clinical_context ?? note.clinical_context;
      if (status === 'saved' && !ClinicalContextSchema.safeParse(context ?? {}).success) throw new DomainError('conflict');
      const author = status === 'saved' ? await stamp(tx, actor_user_id) : null;
      const [row] = await tx<Note[]>`UPDATE clinical.notes SET draft_body = ${draft_body}, clinical_context = ${context ? tx.json(context as Json) : null}, documentation_status = ${status}, saved_at = ${status === 'saved' ? tx`clock_timestamp()` : null}, updated_at = clock_timestamp(), author_stamp = ${author ? tx.json(author) : null}, revision = revision + 1 WHERE id = ${id} RETURNING *`;
      if (status === 'saved' && note.documentation_status === 'draft') await applyDiagnoses(tx, note.admission_id, context, actor_user_id);
      await auditLog(tx, {
        actor_user_id,
        action: 'update',
        record_table: 'clinical.notes',
        record_id: id,
        before: note,
        after: row,
      });
      return serializeNote(row);
    })
    .catch(rethrowDatabaseError);
}

export function listNotesByAdmission(admission_id: string, actor_user_id?: string): Promise<Note[]> {
  return db<Note[]>`
    SELECT * FROM clinical.notes
    WHERE admission_id = ${admission_id} AND (documentation_status = 'saved' OR created_by = ${actor_user_id ?? null})
    ORDER BY COALESCE(saved_at, updated_at) DESC
  `.then(rows => rows.map(serializeNote));
}

// Confirms a draft — locks body into note_versions, next version_no auto-calculated
export async function confirmNote(data: {
  note_id: string;
  body: string;
  confirmed_by: string;
}): Promise<NoteVersion> {
  return db
    .begin(async (tx) => {
      await tx`SELECT id FROM clinical.admissions WHERE id = (SELECT admission_id FROM clinical.notes WHERE id = ${data.note_id}) FOR UPDATE`;
      const [note] = await tx`SELECT id, documentation_status FROM clinical.notes WHERE id = ${data.note_id} FOR UPDATE`;
      if (note?.documentation_status === 'draft') throw new DomainError('conflict');
      const [row] = await tx<NoteVersion[]>`
      INSERT INTO clinical.note_versions (note_id, version_no, body, confirmed_by)
      VALUES (
        ${data.note_id},
        COALESCE((SELECT MAX(version_no) FROM clinical.note_versions WHERE note_id = ${data.note_id}), 0) + 1,
        ${data.body},
        ${data.confirmed_by}
      )
      RETURNING *
    `;
      await auditLog(tx, {
        action: 'confirm',
        record_table: 'clinical.note_versions',
        record_id: row.id,
        actor_user_id: data.confirmed_by,
        after: row,
      });
      return row;
    })
    .catch(rethrowDatabaseError);
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
