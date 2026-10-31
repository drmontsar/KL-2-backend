import { z } from 'zod';

export const WorkItem = z.object({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  patient_name: z.string(),
  ward: z.string().nullable(),
  bed: z.string().nullable(),
  type: z.enum([
    'observation',
    'task',
    'order',
    'alert',
    'nursing_task',
    'medication',
    'nursing_assessment',
  ]),
  status: z.string(),
  due_at: z.string().nullable(),
  priority: z.string(),
});
