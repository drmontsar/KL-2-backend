import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import {
  assignAdmission,
  createAdmission,
  dischargeAdmission,
  getAdmissionById,
  listActiveAdmissions,
  unassignAdmission,
  updateAdmission,
} from '../db/queries/admissions';
import { createDiagnosis } from '../db/queries/diagnoses';
import {
  createNote,
  listNotesByAdmission,
  updateNoteDraft,
} from '../db/queries/notes';
import {
  createOrder,
  listOrdersByAdmission,
  listTasksByAdmission,
} from '../db/queries/orders';
import {
  ActiveAdmissionSchema,
  AdmissionSchema,
  DiagnosisSchema,
  ErrorSchema,
  IdParam,
  NoteSchema,
  OrderSchema,
  TaskSchema,
} from './schemas';

const CreateAdmissionBody = z.object({
  patient_id: z.string().uuid(),
  ward: z.string().optional(),
  bed: z.string().optional(),
  created_by: z.string().uuid().optional(),
});

const AssignBody = z.object({ nurse_id: z.string().uuid() });

const UpdateAdmissionBody = z.object({
  expected_revision: z.number().int().positive(),
  ward: z.string().optional(),
  bed: z.string().optional(),
});

const CreateDiagnosisBody = z.object({
  patient_id: z.string().uuid(),
  description: z.string(),
  created_by: z.string().uuid(),
});

const CreateNoteBody = z.object({
  kind: z.string(),
  draft_body: z.string().optional(),
  created_by: z.string().uuid(),
});

const CreateOrderBody = z.object({
  kind: z.enum(['medication', 'investigation', 'nursing']),
  payload: z.record(z.string(), z.unknown()),
  created_by: z.string().uuid(),
});

const ListQuery = z.object({
  ward: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
});

const OrderStatusQuery = z.object({
  status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
});

const TaskStatusQuery = z.object({
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
});

export const admissionsRouter = new OpenAPIHono();

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/',
    tags: ['Admissions'],
    request: { query: ListQuery },
    responses: {
      200: {
        content: {
          'application/json': { schema: z.array(ActiveAdmissionSchema) },
        },
        description: 'Active admissions',
      },
    },
  }),
  async (c) => {
    const { ward, assigned_to } = c.req.valid('query');
    const admissions = await listActiveAdmissions({ ward, assigned_to });
    return c.json(admissions, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/',
    tags: ['Admissions'],
    request: {
      body: {
        content: { 'application/json': { schema: CreateAdmissionBody } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Admission created',
      },
    },
  }),
  async (c) => {
    const data = c.req.valid('json');
    const admission = await createAdmission(data);
    return c.json(admission, 201);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Admission found',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const admission = await getAdmissionById(id);
    if (!admission) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(admission, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: {
        content: { 'application/json': { schema: UpdateAdmissionBody } },
      },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Admission updated',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already discharged',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Revision conflict — re-fetch and retry',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { expected_revision, ...data } = c.req.valid('json');
    const result = await updateAdmission(id, data, expected_revision);
    if (result === 'conflict') {
      return c.json({ error: 'revision conflict' }, 409);
    }
    if (!result) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(result, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/assign',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: AssignBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Assigned to nurse',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already discharged',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { nurse_id } = c.req.valid('json');
    const admission = await assignAdmission(id, nurse_id);
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/unassign',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Unassigned — returned to unassigned queue',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already discharged',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const admission = await unassignAdmission(id);
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/discharge',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Discharged',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already discharged',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const admission = await dischargeAdmission(id);
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/diagnoses',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: {
        content: { 'application/json': { schema: CreateDiagnosisBody } },
      },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: DiagnosisSchema } },
        description: 'Diagnosis created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const diagnosis = await createDiagnosis({ ...data, admission_id: id });
    return c.json(diagnosis, 201);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/notes',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(NoteSchema) } },
        description: 'Notes for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const notes = await listNotesByAdmission(id);
    return c.json(notes, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/notes',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CreateNoteBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Note created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const note = await createNote({ ...data, admission_id: id });
    return c.json(note, 201);
  }
);

const NoteParam = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
});
const UpdateNoteBody = z.object({ draft_body: z.string() });

admissionsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/notes/{noteId}',
    tags: ['Admissions'],
    request: {
      params: NoteParam,
      body: { content: { 'application/json': { schema: UpdateNoteBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Note updated',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Note not found',
      },
    },
  }),
  async (c) => {
    const { noteId } = c.req.valid('param');
    const { draft_body } = c.req.valid('json');
    const note = await updateNoteDraft(noteId, draft_body);
    if (!note) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(note, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/orders',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      query: OrderStatusQuery,
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(OrderSchema) } },
        description: 'Orders for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('query');
    const orders = await listOrdersByAdmission(id, status);
    return c.json(orders, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/orders',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CreateOrderBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: OrderSchema } },
        description: 'Order created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const order = await createOrder({ ...data, admission_id: id });
    return c.json(order, 201);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/tasks',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      query: TaskStatusQuery,
    },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(TaskSchema) } },
        description: 'Tasks for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { status } = c.req.valid('query');
    const tasks = await listTasksByAdmission(id, status);
    return c.json(tasks, 200);
  }
);
