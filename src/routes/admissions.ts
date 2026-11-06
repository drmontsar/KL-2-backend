import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { UpdateDraftBody } from '../contracts/notes';
import { canAccessResource } from '../db/queries/access';
import {
  assignAdmission,
  dischargeAdmission,
  getAdmissionForUser,
  listAdmissionsForUser,
  moveAdmissionBed,
  unassignAdmission,
  updateAdmission,
} from '../db/queries/admissions';
import { createHandoff } from '../db/queries/handoffs';
import type { User } from '../db/queries/users';

type Variables = { user: User };

import {
  ActiveAdmissionSchema,
  AdmissionSchema,
  ClinicalAlertSchema,
  DiagnosisSchema,
  ErrorSchema,
  HandoffSchema,
  IdParam,
  NoteSchema,
  OrderSchema,
  TaskSchema,
  TransferRequestSchema,
  VitalsSchema,
} from '../contracts/common';
import { createDiagnosis } from '../db/queries/diagnoses';
import { createNote, listNotesByAdmission, updateNoteDraft } from '../db/queries/notes';
import { createOrder, listOrdersByAdmission, listTasksByAdmission } from '../db/queries/orders';
import {
  acknowledgeAlert,
  getObservationSchedule,
  latestNews2,
  listAlertsByAdmission,
  listObservationsByAdmission,
  listVitalsByAdmission,
  recordObservation,
  recordVitals,
  resolveAlert,
  setObservationSchedule,
} from '../db/queries/vitals';

const CreateAdmissionBody = z.object({
  patient_id: z.string().uuid(),
  ward: z.string().optional(),
  bed: z.string().optional(),
  bed_id: z.string().uuid().optional(),
});

const AssignBody = z.object({ nurse_id: z.string().uuid() });
const MoveBedBody = z.object({
  bed_id: z.string().uuid(),
  expected_revision: z.coerce.number().int().positive(),
});

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

const CreateDiagnosisBody = z.object({ description: z.string() });

const CreateNoteBody = z.object({
  kind: z.string(),
  draft_body: z.string().optional(),
});

const CreateOrderBody = z.object({
  kind: z.enum([
    'medication',
    'investigation',
    'nursing',
    'laboratory',
    'imaging',
    'respiratory',
    'diet',
    'clinical',
  ]),
  payload: z.record(z.string(), z.unknown()),
  priority: z.enum(['routine', 'urgent', 'stat']).optional(),
  requires_approval: z.boolean().optional(),
});

const ListQuery = z.object({
  ward: z.string().optional(),
  assigned_to: z.string().uuid().optional(),
  scope: z.enum(['mine', 'open']).optional(),
});

const OrderStatusQuery = z.object({
  status: z.enum(['draft', 'confirmed', 'cancelled', 'completed', 'discontinued']).optional(),
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Legacy response; use admission intake instead',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Use admission request acceptance to assign a nurse and consultant',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'admissions.manage'))
      return c.json({ error: 'admission-management access required' }, 403);
    return c.json({ error: 'create an admission request and accept it with a consultant, nurse and bed' }, 409);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Admission found',
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
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/bed-assignments',
    tags: ['Admissions'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: MoveBedBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Bed assignment changed',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Administrator access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bed unavailable or admission revision changed',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'administrator')
      return c.json({ error: 'administrator access required' }, 403);
    const result = await moveAdmissionBed({
      admission_id: c.req.valid('param').id,
      ...c.req.valid('json'),
      actor_user_id: user.id,
    });
    if (!result) return c.json({ error: 'bed unavailable or admission revision changed' }, 409);
    return c.json(result, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (!hasPermission(user, 'admissions.manage'))
      return c.json({ error: 'admission-management access required' }, 403);
    const check = await getAdmissionForUser(id, user);
    if (!check) return c.json({ error: 'not found or forbidden' }, 403);
    const { expected_revision, ...data } = c.req.valid('json');
    if (
      (data.ward !== undefined && data.ward !== check.ward) ||
      (data.bed !== undefined && data.bed !== check.bed)
    ) {
      return c.json({ error: 'use the bed assignment endpoint to change ward or bed' }, 409);
    }
    const result = await updateAdmission(id, data, expected_revision, user.id);
    if (result === 'conflict') {
      return c.json({ error: 'revision conflict' }, 409);
    }
    if (!result) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(result, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (!hasPermission(user, 'admissions.manage') || !(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { nurse_id } = c.req.valid('json');
    const admission = await assignAdmission(id, nurse_id, user.id);
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/unassign',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
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
    const user = c.get('user');
    if (!hasPermission(user, 'admissions.manage') || !(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const admission = await unassignAdmission(id, user.id);
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/claim',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Claimed — you are now the assigned doctor',
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
    return c.json({ error: 'individual doctor claims are no longer supported' }, 409);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: TransferRequestSchema } },
        description: 'Transfer request created — pending Doctor B acceptance',
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
    return c.json({ error: 'individual doctor transfers are no longer supported' }, 409);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: AdmissionSchema } },
        description: 'Exceptional exit recorded',
      },
      400: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Invalid exit details',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Routine discharge requires a staged plan',
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
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const check = await getAdmissionForUser(id, user);
    if (!check) return c.json({ error: 'not found or forbidden' }, 403);
    const parsed = DischargeBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: 'invalid exit details' }, 400);
    const body = parsed.data;
    if (body.exit_type !== 'died' && body.exit_type !== 'transfer_team') {
      return c.json({ error: 'routine discharge requires a staged discharge plan' }, 409);
    }
    const admission = await dischargeAdmission(id, {
      ...body,
      exit_type: body.exit_type,
      actor_user_id: user.id,
    });
    if (!admission) {
      return c.json({ error: 'not found or already discharged' }, 404);
    }
    return c.json(admission, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: DiagnosisSchema } },
        description: 'Diagnosis created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor'))
      return c.json({ error: 'doctor access required' }, 403);
    const admission = await getAdmissionForUser(id, user);
    if (!admission) return c.json({ error: 'not found or forbidden' }, 403);
    const data = c.req.valid('json');
    const diagnosis = await createDiagnosis({
      ...data,
      admission_id: id,
      patient_id: admission.patient_id,
      created_by: user.id,
    });
    return c.json(diagnosis, 201);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/notes',
    tags: ['Admissions'],
    request: { params: IdParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(NoteSchema) } },
        description: 'Notes for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await getAdmissionForUser(id, c.get('user'))))
      return c.json({ error: 'not found or forbidden' }, 403);
    const notes = await listNotesByAdmission(id);
    return c.json(notes, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Note created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const data = c.req.valid('json');
    const note = await createNote({ ...data, admission_id: id, created_by: user.id });
    return c.json(note, 201);
  },
);

const NoteParam = z.object({
  id: z.string().uuid(),
  noteId: z.string().uuid(),
});
const UpdateNoteBody = UpdateDraftBody;

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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: NoteSchema } },
        description: 'Note updated',
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
    const { id, noteId } = c.req.valid('param');
    const user = c.get('user');
    if (
      !(await getAdmissionForUser(id, user)) ||
      !(await canAccessResource(user, 'note', noteId))
    ) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { draft_body, expected_revision } = c.req.valid('json');
    const note = await updateNoteDraft(noteId, draft_body, expected_revision, user.id, id);
    if (!note) {
      return c.json({ error: 'not found' }, 404);
    }
    return c.json(note, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(OrderSchema) } },
        description: 'Orders for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await getAdmissionForUser(id, c.get('user'))))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { status } = c.req.valid('query');
    const orders = await listOrdersByAdmission(id, status);
    return c.json(orders, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: OrderSchema } },
        description: 'Order created',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!hasPermission(user, 'clinical.doctor') || !(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const data = c.req.valid('json');
    const order = await createOrder({ ...data, admission_id: id, created_by: user.id });
    return c.json(order, 201);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(TaskSchema) } },
        description: 'Tasks for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    if (!(await getAdmissionForUser(id, c.get('user'))))
      return c.json({ error: 'not found or forbidden' }, 403);
    const { status } = c.req.valid('query');
    const tasks = await listTasksByAdmission(id, status);
    return c.json(tasks, 200);
  },
);

const CreateHandoffBody = z.object({ reason: z.string().max(10000).optional() });

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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: HandoffSchema } },
        description: 'Handoff created — nurse notified',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission or nurse assignment changed',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission not found or no nurse assigned',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    const { reason } = c.req.valid('json');
    const admission = await getAdmissionForUser(id, user);
    if (!admission || admission.status !== 'active') {
      return c.json({ error: 'admission not found or not active' }, 404);
    }
    if (!admission.assigned_to) {
      return c.json({ error: 'no nurse assigned to this admission' }, 404);
    }
    const handoff = await createHandoff({
      admission_id: id,
      requested_by: user.id,
      assigned_to: admission.assigned_to,
      reason,
    });

    return c.json(handoff, 201);
  },
);

const VitalsListQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const RecordVitalsBody = z
  .object({
    recorded_by: z.string().uuid().optional(),
    bp_systolic: z.number().int().min(40).max(300).optional(),
    bp_diastolic: z.number().int().min(20).max(200).optional(),
    heart_rate: z.number().int().min(20).max(250).optional(),
    spo2: z.number().min(50).max(100).optional(),
    resp_rate: z.number().int().min(1).max(80).optional(),
    temperature: z.number().min(25).max(45).optional(),
    glucose: z.number().int().positive().optional(),
  })
  .refine(
    (body) =>
      body.bp_systolic === undefined ||
      body.bp_diastolic === undefined ||
      body.bp_diastolic < body.bp_systolic,
    'diastolic pressure must be below systolic pressure',
  )
  .refine(
    (body) =>
      [
        body.bp_systolic,
        body.bp_diastolic,
        body.heart_rate,
        body.spo2,
        body.resp_rate,
        body.temperature,
        body.glucose,
      ].some((value) => value !== undefined),
    'at least one measurement is required',
  );

const RecordObservationBody = z
  .object({
    bp_systolic: z.number().int().min(40).max(300),
    bp_diastolic: z.number().int().min(20).max(200).optional(),
    heart_rate: z.number().int().min(20).max(250),
    spo2: z.number().min(50).max(100),
    resp_rate: z.number().int().min(1).max(80),
    temperature: z.number().min(25).max(45),
    glucose: z.number().int().positive().optional(),
    on_supplemental_oxygen: z.boolean(),
    consciousness: z.enum(['alert', 'confusion', 'voice', 'pain', 'unresponsive']),
  })
  .refine(
    (body) => body.bp_diastolic === undefined || body.bp_diastolic < body.bp_systolic,
    'diastolic pressure must be below systolic pressure',
  );

const AlertListQuery = z.object({
  status: z.enum(['active', 'acknowledged', 'resolved', 'superseded']).optional(),
});

const ObservationScheduleSchema = z.object({
  admission_id: z.string().uuid(),
  frequency_minutes: z.number().int(),
  next_due_at: z.string(),
  source: z.enum(['news2_policy', 'manual']),
  reason: z.string().nullable(),
  policy_version: z.string(),
  updated_by: z.string().uuid().nullable(),
  updated_at: z.string(),
  due_status: z.enum(['scheduled', 'due', 'overdue']),
});

const SetObservationScheduleBody = z.object({
  frequency_minutes: z.number().int().min(5).max(1440),
  reason: z.string().trim().min(5).max(500),
});

const LatestNews2Schema = z.object({
  admission_id: z.string().uuid(),
  observation_id: z.string().uuid(),
  recorded_at: z.string(),
  news2_score: z.number().int(),
  news2_escalation: z.enum(['low', 'low-medium', 'medium', 'high']),
  news2_component_scores: z.record(z.string(), z.number()),
  news2_rule_version: z.string(),
  frequency_minutes: z.number().int().nullable(),
  next_due_at: z.string().nullable(),
  due_status: z.enum(['scheduled', 'due', 'overdue']).nullable(),
});

const ResolveAlertBody = z.object({ reason: z.string().trim().min(5).max(500) });

const AlertParam = z.object({
  id: z.string().uuid(),
  alertId: z.string().uuid(),
});

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/vitals',
    tags: ['Admissions'],
    request: { params: IdParam, query: VitalsListQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(VitalsSchema) } },
        description: 'Vitals history for this admission, most recent first',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { limit } = c.req.valid('query');
    const vitals = await listVitalsByAdmission(id, limit);
    return c.json(vitals, 200);
  },
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
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: VitalsSchema } },
        description: 'Vitals recorded',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission is not active',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const data = c.req.valid('json');
    const vitals = await recordVitals({ ...data, admission_id: id, recorded_by: user.id });
    if (!vitals) return c.json({ error: 'admission is not active' }, 409);
    return c.json(vitals, 201);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/observations',
    tags: ['Observations'],
    request: { params: IdParam, query: VitalsListQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(VitalsSchema) } },
        description: 'Complete observation sets and NEWS2 trend, most recent first',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { limit } = c.req.valid('query');
    return c.json(await listObservationsByAdmission(id, limit), 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/observations',
    tags: ['Observations'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: RecordObservationBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: VitalsSchema } },
        description: 'Observation recorded and NEWS2 calculated using Scale 1',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admission is not active',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const observation = await recordObservation({
      ...c.req.valid('json'),
      admission_id: id,
      recorded_by: user.id,
    });
    if (!observation) return c.json({ error: 'admission is not active' }, 409);
    return c.json(observation, 201);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/alerts',
    tags: ['Observations'],
    request: { params: IdParam, query: AlertListQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(ClinicalAlertSchema) } },
        description: 'Clinical alerts for this admission',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const { status } = c.req.valid('query');
    return c.json(await listAlertsByAdmission(id, status), 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/alerts/{alertId}/acknowledge',
    tags: ['Observations'],
    request: { params: AlertParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: ClinicalAlertSchema } },
        description: 'Clinical alert acknowledged',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Alert not found or already acknowledged',
      },
    },
  }),
  async (c) => {
    const { id, alertId } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user))) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const alert = await acknowledgeAlert(alertId, id, user.id);
    if (!alert) return c.json({ error: 'alert not found or already acknowledged' }, 409);
    return c.json(alert, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/news2/latest',
    tags: ['Observations'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: LatestNews2Schema } },
        description: 'Latest NEWS2 projection',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'No NEWS2 observation found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const latest = await latestNews2(id);
    if (!latest) return c.json({ error: 'no NEWS2 observation found' }, 404);
    return c.json(latest, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/{id}/observation-schedule',
    tags: ['Observations'],
    request: { params: IdParam },
    responses: {
      200: {
        content: { 'application/json': { schema: ObservationScheduleSchema } },
        description: 'Observation schedule and due state',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      404: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'No observation schedule found',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (!(await getAdmissionForUser(id, user)))
      return c.json({ error: 'not found or forbidden' }, 403);
    const schedule = await getObservationSchedule(id);
    if (!schedule) return c.json({ error: 'no observation schedule found' }, 404);
    return c.json(schedule, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/{id}/observation-schedule',
    tags: ['Observations'],
    request: {
      params: IdParam,
      body: { content: { 'application/json': { schema: SetObservationScheduleBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: ObservationScheduleSchema } },
        description: 'Observation schedule updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description:
          'Admission inactive, NEWS2 missing, or requested interval exceeds the current policy',
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const user = c.get('user');
    if (
      (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse')) ||
      !(await getAdmissionForUser(id, user))
    ) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const schedule = await setObservationSchedule({
      admission_id: id,
      ...c.req.valid('json'),
      updated_by: user.id,
    });
    if (!schedule)
      return c.json(
        {
          error:
            'admission inactive, NEWS2 missing, or requested interval exceeds the current policy',
        },
        409,
      );
    return c.json(schedule, 200);
  },
);

admissionsRouter.openapi(
  createRoute({
    method: 'post',
    path: '/{id}/alerts/{alertId}/resolve',
    tags: ['Observations'],
    request: {
      params: AlertParam,
      body: { content: { 'application/json': { schema: ResolveAlertBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: ClinicalAlertSchema } },
        description: 'Clinical alert resolved',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Alert is not active',
      },
    },
  }),
  async (c) => {
    const { id, alertId } = c.req.valid('param');
    const user = c.get('user');
    if (
      (!hasPermission(user, 'clinical.doctor') && !hasPermission(user, 'clinical.nurse')) ||
      !(await getAdmissionForUser(id, user))
    ) {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    const alert = await resolveAlert(alertId, id, user.id, c.req.valid('json').reason);
    if (!alert) return c.json({ error: 'alert is not active' }, 409);
    return c.json(alert, 200);
  },
);
