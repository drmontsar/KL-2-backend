import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import type { User } from '../db/queries/users';
import {
  assignAdmission,
  claimAdmission,
  createAdmission,
  dischargeAdmission,
  getAdmissionById,
  getAdmissionForUser,
  listAdmissionsForUser,
  unassignAdmission,
  updateAdmission,
} from '../db/queries/admissions';
import { createTransferRequest } from '../db/queries/transfer_requests';

type Variables = { user: User };
import { createHandoff } from '../db/queries/handoffs';
import { createNotification } from '../db/queries/notifications';
import { listVitalsByAdmission, recordVitals } from '../db/queries/vitals';
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
  HandoffSchema,
  IdParam,
  NoteSchema,
  OrderSchema,
  TaskSchema,
  TransferRequestSchema,
  VitalsSchema,
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
  severity: z.enum(['unstable', 'watcher', 'stable']).optional(),
});

const DischargeBody = z.object({
  exit_type: z.enum(['discharged', 'transfer_team', 'transfer_out', 'lama', 'died']).optional(),
  exit_dest: z.string().optional(),
  exit_note: z.string().optional(),
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
  scope: z.enum(['mine', 'open']).optional(),
});

const OrderStatusQuery = z.object({
  status: z.enum(['draft', 'confirmed', 'cancelled']).optional(),
});

const TaskStatusQuery = z.object({
  status: z.enum(['pending', 'done', 'cancelled']).optional(),
});

export const admissionsRouter = new OpenAPIHono<{ Variables: Variables }>();

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
    const { ward, scope } = c.req.valid('query');
    const user = c.get('user');
    const admissions = await listAdmissionsForUser(user, { scope, ward });
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const admission = await getAdmissionForUser(id, user);
    if (!admission) {
      return c.json({ error: 'not found or forbidden' }, 403);
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
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
    const user = c.get('user');
    const check = await getAdmissionForUser(id, user);
    if (!check) return c.json({ error: 'not found or forbidden' }, 403);
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
    path: '/{id}/claim',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Claimed — you are now the assigned doctor',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Nurses cannot claim admissions',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not found or not active',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Already claimed by another doctor',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (user.role !== 'doctor') {
      return c.json({ error: 'only doctors can claim admissions' }, 403);
    }
    const result = await claimAdmission(id, user.id);
    if (result === 'already_claimed') return c.json({ error: 'already claimed by another doctor' }, 409);
    if (!result) return c.json({ error: 'not found or not active' }, 404);
    return c.json(result, 200);
  }
);

const TransferDoctorBody = z.object({
  to_doctor_id: z.string().uuid(),
  expected_revision: z.number().int().positive(),
  message: z.string().optional(),
});

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/transfer-doctor',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: TransferDoctorBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: TransferRequestSchema } },
        description: 'Transfer request created — pending Doctor B acceptance',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not your patient or not a doctor',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission or target doctor not found',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Revision conflict — re-fetch and retry',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (user.role !== 'doctor') return c.json({ error: 'only doctors can transfer admissions' }, 403);
    const { to_doctor_id, expected_revision, message } = c.req.valid('json');
    if (to_doctor_id === user.id) return c.json({ error: 'cannot transfer to yourself' }, 409);
    const result = await createTransferRequest({
      admission_id: id,
      from_doctor_id: user.id,
      to_doctor_id,
      expected_revision,
      message,
    });
    if (result === 'not_owner') return c.json({ error: 'not your patient' }, 403);
    if (result === 'conflict') return c.json({ error: 'revision conflict' }, 409);
    if (result === 'bad_target') return c.json({ error: 'target doctor not found or inactive' }, 404);
    await createNotification({
      user_id: to_doctor_id,
      type: 'transfer.requested',
      payload: {
        request_id: result.id,
        admission_id: id,
        from_doctor_id: user.id,
        patient_name: result.patient_name,
        ward: result.ward,
        bed: result.bed,
      },
    });
    return c.json(result, 201);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/discharge',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: DischargeBody } }, required: false },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Discharged',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or already discharged',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const check = await getAdmissionForUser(id, user);
    if (!check) return c.json({ error: 'not found or forbidden' }, 403);
    const body = await c.req.json().catch(() => ({})) as { exit_type?: string; exit_dest?: string; exit_note?: string };
    const admission = await dischargeAdmission(id, {
      exit_type: (body.exit_type ?? 'discharged') as Parameters<typeof dischargeAdmission>[1] extends { exit_type: infer T } ? T : never,
      exit_dest: body.exit_dest,
      exit_note: body.exit_note,
    });
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

const CreateHandoffBody = z.object({
  requested_by: z.string().uuid(),
  reason: z.string().optional(),
});

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/handoffs',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: CreateHandoffBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: HandoffSchema } },
        description: 'Handoff created — nurse notified',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not found or no nurse assigned',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { requested_by, reason } = c.req.valid('json');
    const admission = await getAdmissionById(id);
    if (!admission || admission.status !== 'active') {
      return c.json({ error: 'admission not found or not active' }, 404);
    }
    if (!admission.assigned_to) {
      return c.json({ error: 'no nurse assigned to this admission' }, 404);
    }
    const handoff = await createHandoff({
      admission_id: id,
      requested_by,
      assigned_to: admission.assigned_to,
      reason,
    });
    await createNotification({
      user_id: admission.assigned_to,
      type: 'handoff.created',
      payload: { handoff_id: handoff.id, admission_id: id, reason: reason ?? null },
    });
    return c.json(handoff, 201);
  }
);

const VitalsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const RecordVitalsBody = z.object({
  recorded_by: z.string().uuid(),
  bp_systolic: z.number().int().optional(),
  bp_diastolic: z.number().int().optional(),
  heart_rate: z.number().int().optional(),
  spo2: z.number().optional(),
  resp_rate: z.number().int().optional(),
  temperature: z.number().optional(),
  glucose: z.number().int().optional(),
});

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/vitals',
    tags: ['Admissions'],
    request: { params: IdParam, query: VitalsListQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(VitalsSchema) } },
        description: 'Vitals history for this admission, most recent first',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { limit } = c.req.valid('query');
    const vitals = await listVitalsByAdmission(id, limit);
    return c.json(vitals, 200);
  }
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/vitals',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: RecordVitalsBody } } },
    },
    responses: {
      201: {
        content: { 'application/json': { schema: VitalsSchema } },
        description: 'Vitals recorded',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const data = c.req.valid('json');
    const vitals = await recordVitals({ ...data, admission_id: id });
    return c.json(vitals, 201);
  }
);
