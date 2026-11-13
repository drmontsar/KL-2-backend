import { z } from 'zod';
import { ClinicalContextDraftSchema } from './common';

export const UpdateDraftBody = z.object({
  draft_body: z.string(),
  expected_revision: z.number().int().positive(),
  clinical_context: ClinicalContextDraftSchema.optional(),
  documentation_status: z.enum(['draft','saved']).optional(),
});
