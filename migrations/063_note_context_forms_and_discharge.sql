-- up
-- 062 is reserved for patient chat in the chat worktree.
-- Clinical context is explicitly authored, never inferred from narrative notes.
ALTER TABLE clinical.notes ADD COLUMN IF NOT EXISTS clinical_context jsonb;
ALTER TABLE clinical.discharge_plans ADD COLUMN IF NOT EXISTS final_diagnosis text;
ALTER TABLE forms.signatures ADD COLUMN IF NOT EXISTS strokes jsonb;
ALTER TABLE clinical.discharge_plans ADD CONSTRAINT discharge_final_diagnosis_not_blank
  CHECK (final_diagnosis IS NULL OR length(trim(final_diagnosis)) > 0);

-- down
ALTER TABLE clinical.discharge_plans DROP CONSTRAINT discharge_final_diagnosis_not_blank;
ALTER TABLE forms.signatures DROP COLUMN strokes;
ALTER TABLE clinical.discharge_plans DROP COLUMN final_diagnosis;
ALTER TABLE clinical.notes DROP COLUMN clinical_context;
