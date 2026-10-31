import { z } from 'zod';

export const UpdateDraftBody = z.object({
  draft_body: z.string(),
  expected_revision: z.number().int().positive(),
});
