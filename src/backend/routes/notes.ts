import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  addAmendment,
  confirmNote,
  listNoteVersions,
  updateNoteDraft,
} from '../db/queries/notes';
import {
  AmendmentSchema,
  ErrorSchema,
  IdParam,
  NoteSchema,
  NoteVersionSchema,
} from './schemas';

const VersionIdParam = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

const UpdateDraftBody = z.object({ draft_body: z.string() });
const ConfirmNoteBody = z.object({
  body: z.string(),
  confirmed_by: z.string().uuid(),
});
const AddAmendmentBody = z.object({
  body: z.string(),
  reason: z.string().optional(),
  created_by: z.string().uuid(),
});

export const notesRouter = new OpenAPIHono();

notesRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/draft',
    tags: ['Notes'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: UpdateDraftBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Draft updated',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Note not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { draft_body } = c.req.valid('json');
    const note = await updateNoteDraft(id, draft_body);
    if (!note) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(note, 200);
  }
);

notesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/confirm',
    tags: ['Notes'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: ConfirmNoteBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: NoteVersionSchema } },
        description: 'Note confirmed, version created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { body, confirmed_by } = c.req.valid('json');
    const version = await confirmNote({ note_id: id, body, confirmed_by });
    return c.json(version, 201);
  }
);

notesRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/versions',
    tags: ['Notes'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(NoteVersionSchema) } },
        description: 'Note versions',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const versions = await listNoteVersions(id);
    return c.json(versions, 200);
  }
);

notesRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/versions/{versionId}/amendments',
    tags: ['Notes'],
    request: {
      params: VersionIdParam,
      body: { content: { 'application/json': { schema: AddAmendmentBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: AmendmentSchema } },
        description: 'Amendment added',
      },
    },
  }),
  async (c) => {
    const { versionId } = c.req.valid('param');
    const data = c.req.valid('json');
    const amendment = await addAmendment({
      note_version_id: versionId,
      ...data,
    });
    return c.json(amendment, 201);
  }
);
