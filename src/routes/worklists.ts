import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { WorkItem } from '../contracts/worklists';
import { listOverdueTasks } from '../db/queries/worklists';

import { listAdmissionsForUser } from '../db/queries/admissions';
import type { User } from '../db/queries/users';

type Variables = { user: User };
export const worklistsRouter = new OpenAPIHono<{ Variables: Variables }>();

worklistsRouter.openapi(
  createRoute({
    method: 'get',
    path: '/me',
    tags: ['Worklists'],
    responses: {
      200: {
        content: { 'application/json': { schema: z.array(WorkItem) } },
        description: 'Work items for the signed-in user',
      },
    },
  }),
  async (c) => {
    const user = c.get('user');
    const admissions = await listAdmissionsForUser(user);
    const ids = admissions.map((admission) => admission.id);
    if (!ids.length) return c.json([], 200);

    const rows = await listOverdueTasks(ids, user.role);
    return c.json(
      rows.map((row) => ({ ...row, due_at: row.due_at?.toISOString() ?? null })),
      200,
    );
  },
);
