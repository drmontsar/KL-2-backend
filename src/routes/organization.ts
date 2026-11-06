import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { hasPermission } from '../authorization';
import { ErrorSchema } from '../contracts/common';
import {
  listBeds,
  listDepartments,
  listFacilities,
  listRooms,
  listUnits,
  listWardCensus,
  listWards,
  updateBedOperationalState,
} from '../db/queries/organization';
import type { User } from '../db/queries/users';

const FacilitySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  created_at: z.string(),
});
const DepartmentSchema = z.object({
  id: z.string().uuid(),
  facility_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  created_at: z.string(),
});
const UnitSchema = z.object({
  id: z.string().uuid(),
  department_id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(['inpatient', 'icu', 'emergency', 'opd', 'procedure']),
  created_at: z.string(),
});
const WardSchema = z.object({
  id: z.string().uuid(),
  unit_id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
});
const RoomSchema = z.object({
  id: z.string().uuid(),
  ward_id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
});
const BedSchema = z.object({
  id: z.string().uuid(),
  room_id: z.string().uuid(),
  room_name: z.string(),
  ward_id: z.string().uuid(),
  ward_name: z.string(),
  label: z.string(),
  operational_state: z.enum(['available', 'cleaning', 'out_of_service']),
  occupancy: z.enum(['available', 'occupied', 'reserved', 'cleaning', 'out_of_service']),
});
const CensusEntrySchema = BedSchema.extend({
  admission_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  patient_name: z.string(),
  severity: z.enum(['unstable', 'watcher', 'stable']),
  assigned_doctor_id: z.string().uuid().nullable(),
  assigned_to: z.string().uuid().nullable(),
  arrival_status: z.enum(['incoming', 'admitted']),
});

const FacilityQuery = z.object({ facility_id: z.string().uuid().optional() });
const UnitQuery = z.object({ unit_id: z.string().uuid().optional() });
const RoomQuery = z.object({ ward_id: z.string().uuid().optional() });
const BedQuery = z.object({
  ward_id: z.string().uuid().optional(),
  occupancy: z.enum(['available', 'occupied', 'reserved', 'cleaning', 'out_of_service']).optional(),
});
const WardParam = z.object({ id: z.string().uuid() });
const BedStateBody = z.object({
  operational_state: z.enum(['available', 'cleaning', 'out_of_service']),
});

type Variables = { user: User };
export const organizationRouter = new OpenAPIHono<{ Variables: Variables }>();

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/facilities',
    tags: ['Hospital Structure'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(FacilitySchema) } },
        description: 'Facilities',
      },
    },
  }),
  async (c) => c.json(await listFacilities(), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/departments',
    tags: ['Hospital Structure'],
    request: { query: FacilityQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(DepartmentSchema) } },
        description: 'Departments',
      },
    },
  }),
  async (c) => c.json(await listDepartments(c.req.valid('query').facility_id), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/units',
    tags: ['Hospital Structure'],
    request: { query: FacilityQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(UnitSchema) } },
        description: 'Units',
      },
    },
  }),
  async (c) => c.json(await listUnits(c.req.valid('query').facility_id), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/wards',
    tags: ['Hospital Structure'],
    request: { query: UnitQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(WardSchema) } },
        description: 'Wards',
      },
    },
  }),
  async (c) => c.json(await listWards(c.req.valid('query').unit_id), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/rooms',
    tags: ['Hospital Structure'],
    request: { query: RoomQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(RoomSchema) } },
        description: 'Rooms',
      },
    },
  }),
  async (c) => c.json(await listRooms(c.req.valid('query').ward_id), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/beds',
    tags: ['Hospital Structure'],
    request: { query: BedQuery },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(BedSchema) } },
        description: 'Beds and current occupancy',
      },
    },
  }),
  async (c) => c.json(await listBeds(c.req.valid('query')), 200),
);

organizationRouter.openapi(
  createRoute({
    method: 'patch',
    path: '/beds/{id}',
    tags: ['Hospital Structure'],
    request: {
      params: WardParam,
      body: { content: { 'application/json': { schema: BedStateBody } } },
    },
    responses: {
      200: {
        content: { 'application/json': { schema: BedSchema } },
        description: 'Bed state updated',
      },
      403: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Admin access required',
      },
      409: {
        content: { 'application/json': { schema: ErrorSchema } },
        description: 'Bed not found or currently occupied',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    if (!hasPermission(user, 'beds.manage'))
      return c.json({ error: 'bed-management access required' }, 403);
    const bed = await updateBedOperationalState(
      c.req.valid('param').id,
      c.req.valid('json').operational_state,
      user.id,
    );
    if (!bed) return c.json({ error: 'bed not found or currently occupied' }, 409);
    return c.json(bed, 200);
  },
);

organizationRouter.openapi(
  createRoute({
    method: 'get',
    path: '/wards/{id}/census',
    tags: ['Hospital Structure'],
    request: { params: WardParam },
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(CensusEntrySchema) } },
        description: 'Role-scoped ward census',
      },
    },
  }),
  async (c) => c.json(await listWardCensus(c.req.valid('param').id, c.get('user')), 200),
);
