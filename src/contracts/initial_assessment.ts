import { z } from 'zod';

export const InitialAssessmentBody = z.object({
  chief_complaint: z.string().trim().min(1),
  history: z.string().trim().min(1),
  examination: z.string().trim().min(1),
  clinical_impression: z.string().trim().min(1),
  plan: z.string().trim().min(1),
});

export const InitialAssessmentSchema = InitialAssessmentBody.extend({
  id: z.string().uuid(),
  admission_id: z.string().uuid(),
  assessed_by: z.string().uuid(),
  signed_at: z.string(),
});

export type InitialAssessmentInput = z.infer<typeof InitialAssessmentBody>;
export type InitialAssessment = z.infer<typeof InitialAssessmentSchema>;
