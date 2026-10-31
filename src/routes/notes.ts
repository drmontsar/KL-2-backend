import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  AmendmentSchema,
  ErrorSchema,
  IdParam,
  NoteSchema,
  NoteVersionSchema,
} from '../contracts/common';
import { UpdateDraftBody } from '../contracts/notes';
import { canAccessResource } from '../db/queries/access';
import { addAmendment, confirmNote, listNoteVersions, updateNoteDraft } from '../db/queries/notes';
import type { User } from '../db/queries/users';

const VersionIdParam = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

const ConfirmNoteBody = z.object({ body: z.string() });
const AddAmendmentBody = z.object({
  body: z.string(),
  reason: z.string().optional(),
});

type Variables = { user: User };

export const notesRouter = new OpenAPIHono<{ Variables: Variables }>();

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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Draft updated',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Revision conflict',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Note not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessResource(c.get('user'), 'note', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { draft_body, expected_revision } = c.req.valid('json');
    const note = await updateNoteDraft(id, draft_body, expected_revision, c.get('user').id);
    if (!note) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(note, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: NoteVersionSchema } },
        description: 'Note confirmed, version created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await canAccessResource(user, 'note', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { body } = c.req.valid('json');
    const version = await confirmNote({ note_id: id, body, confirmed_by: user.id });
    return c.json(version, 201);
  },
);

notesRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/versions',
    tags: ['Notes'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(NoteVersionSchema) } },
        description: 'Note versions',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await canAccessResource(c.get('user'), 'note', id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const versions = await listNoteVersions(id);
    return c.json(versions, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: AmendmentSchema } },
        description: 'Amendment added',
      },
    },
  }),
  async (c) => {
    const { versionId } = c.req.valid('param');
    const user = c.get('user');
    if (!(await canAccessResource(user, 'note_version', versionId)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const data = c.req.valid('json');
    const amendment = await addAmendment({
      note_version_id: versionId,
      ...data,
      created_by: user.id,
    });
    return c.json(amendment, 201);
  },
);
