import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { ErrorSchema } from '../contracts/common';
import { canAccessAdmission } from '../db/queries/access';
import {
  createShift,
  createStaffAssignment,
  endStaffAssignment,
  grantBreakGlass,
  listShifts,
  listStaffAssignments,
  listUnitMemberships,
  replaceUnitMemberships,
  transitionShift,
} from '../db/queries/staff_scope';
import type { User } from '../db/queries/users';

const UserParam = z.object({ id: z.string().uuid() });
const AdmissionParam = z.object({ id: z.string().uuid() });
const AssignmentParam = z.object({ id: z.string().uuid(), assignmentId: z.string().uuid() });
const ShiftParam = z.object({ id: z.string().uuid() });
const UnitMembershipSchema = z.object({
  user_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  is_primary: z.boolean(),
  created_at: z.string(),
});
const ReplaceMembershipsBody = z.object({
  units: z
    .array(z.object({ unit_id: z.string().uuid(), is_primary: z.boolean().default(false) }))
    .max(20)
    .refine(
      (units) => new Set(units.map((unit) => unit.unit_id)).size === units.length,
      'duplicate unit',
    ),
});
const ShiftSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(['scheduled', 'active', 'completed', 'cancelled']),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  unit_ids: z.array(z.string().uuid()),
});
const CreateShiftBody = z
  .object({
    user_id: z.string().uuid(),
    starts_at: z.coerce.date(),
    ends_at: z.coerce.date(),
    unit_ids: z.array(z.string().uuid()).min(1),
  })
  .refine((body) => body.ends_at > body.starts_at, { message: 'ends_at must be after starts_at' });
const ShiftListQuery = z.object({
  user_id: z.string().uuid().optional(),
  status: z.enum(['scheduled', 'active', 'completed', 'cancelled']).optional(),
});
const AssignmentSchema = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  user_id: z.string().uuid(),
  assignment_type: z.enum(['treating_consultant', 'duty_doctor', 'primary_nurse', 'coverage']),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  assigned_by: z.string().uuid().nullable(),
});
const AssignmentBody = z.object({
  user_id: z.string().uuid(),
  assignment_type: z.enum(['treating_consultant', 'primary_nurse', 'coverage']),
});
const BreakGlassBody = z.object({ reason: z.string().trim().min(10).max(500) });
const BreakGlassSchema = z.object({ id: z.string().uuid(), expires_at: z.string() });

type Variables = { user: User };
export const staffScopeRouter = new OpenAPIHono<{ Variables: Variables }>();

staffScopeRouter.openapi(
  createRoute({
    method: 'get',
    path: '/staff/{id}/units',
    tags: ['Staff Scope'],
    request: { params: UserParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(UnitMembershipSchema) } },
        description: 'Unit memberships',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (user.job_role !== 'administrator' && user.id !== id)
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listUnitMemberships(id), 200);
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'put',
    path: '/staff/{id}/units',
    tags: ['Staff Scope'],
    request: {
      params: UserParam,
      body: { content: { 'application/json': { schema: ReplaceMembershipsBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(UnitMembershipSchema) } },
        description: 'Unit memberships replaced',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'administrator')
      return c.json({ error: 'administrator access required' }, 403);
    return c.json(
      await replaceUnitMemberships(c.req.valid('param').id, c.req.valid('json').units, user.id),
      200,
    );
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'get',
    path: '/shifts',
    tags: ['Staff Scope'],
    request: { query: ShiftListQuery },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(ShiftSchema) } },
        description: 'Shifts',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const query = c.req.valid('query');
    if (query.user_id && query.user_id !== user.id && user.job_role !== 'administrator') {
      return c.json({ error: 'not found or forbidden' }, 403);
    }
    return c.json(await listShifts({ ...query, user_id: query.user_id ?? user.id }), 200);
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/shifts',
    tags: ['Staff Scope'],
    request: { body: { content: { 'application/json': { schema: CreateShiftBody } } } },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Invalid state, scope, or conflicting record',
      },
      201: {
        content: { 'application/json': { schema: ShiftSchema } },
        description: 'Shift created',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'administrator')
      return c.json({ error: 'administrator access required' }, 403);
    const body = c.req.valid('json');

    const shift = await createShift({ ...body, created_by: user.id });
    if (!shift) return c.json({ error: 'shift units must belong to the staff member' }, 409);
    return c.json(shift, 201);
  },
);

for (const transition of ['active', 'completed', 'cancelled'] as const) {
  staffScopeRouter.openapi(
    createRoute({
      method: 'post',
      path: `/shifts/{id}/${transition}`,
      tags: ['Staff Scope'],
      request: { params: ShiftParam },
      responses: {
        403: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Not found or access denied',
        },
        409: {
          content: { 'application/json': { schema: ErrorSchema } },
          description: 'Invalid state, scope, or conflicting record',
        },
        200: {
          content: { 'application/json': { schema: ShiftSchema } },
          description: `Shift marked ${transition}`,
        },
      },
    }),
    async (c) => {
      const user = c.get('user');

      const shift = await transitionShift(
        c.req.valid('param').id,
        user.id,
        transition,
        user.job_role === 'administrator',
      );
      if (!shift) return c.json({ error: 'shift not found or transition is invalid' }, 409);
      return c.json(shift, 200);
    },
  );
}

staffScopeRouter.openapi(
  createRoute({
    method: 'get',
    path: '/admissions/{id}/staff-assignments',
    tags: ['Staff Scope'],
    request: { params: AdmissionParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      200: {
        content: { 'application/json': { schema: z.array(AssignmentSchema) } },
        description: 'Active staff assignments',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const { id } = c.req.valid('param');
    if (!(await canAccessAdmission(user, id)))
      return c.json({ error: 'not found or forbidden' }, 403);
    return c.json(await listStaffAssignments(id), 200);
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/staff-assignments',
    tags: ['Staff Scope'],
    request: {
      params: AdmissionParam,
      body: { content: { 'application/json': { schema: AssignmentBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Invalid state, scope, or conflicting record',
      },
      201: {
        content: { 'application/json': { schema: AssignmentSchema } },
        description: 'Staff assigned',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'administrator')
      return c.json({ error: 'administrator access required' }, 403);
    const assignment = await createStaffAssignment({
      admission_id: c.req.valid('param').id,
      ...c.req.valid('json'),
      assigned_by: user.id,
    });
    if (!assignment)
      return c.json({ error: 'invalid role, unit membership, or duplicate assignment' }, 409);
    return c.json(assignment, 201);
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'delete',
    path: '/admissions/{id}/staff-assignments/{assignmentId}',
    tags: ['Staff Scope'],
    request: { params: AssignmentParam },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Invalid state, scope, or conflicting record',
      },
      200: {
        content: { 'application/json': { schema: AssignmentSchema } },
        description: 'Assignment ended',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (user.job_role !== 'administrator')
      return c.json({ error: 'administrator access required' }, 403);
    const { id, assignmentId } = c.req.valid('param');
    const assignment = await endStaffAssignment(assignmentId, id, user.id);
    if (!assignment) return c.json({ error: 'active assignment not found' }, 409);
    return c.json(assignment, 200);
  },
);

staffScopeRouter.openapi(
  createRoute({
    method: 'post',
    path: '/admissions/{id}/break-glass',
    tags: ['Staff Scope'],
    request: {
      params: AdmissionParam,
      body: { content: { 'application/json': { schema: BreakGlassBody } } },
    },
    responses: {
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Not found or access denied',
      },
      201: {
        content: { 'application/json': { schema: BreakGlassSchema } },
        description: 'Emergency access granted for 60 minutes',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!['duty_doctor', 'consultant', 'staff_nurse'].includes(user.job_role)) {
      return c.json({ error: 'clinical staff access required' }, 403);
    }
    return c.json(
      await grantBreakGlass({
        user_id: user.id,
        admission_id: c.req.valid('param').id,
        reason: c.req.valid('json').reason,
      }),
      201,
    );
  },
);
