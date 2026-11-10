-- up
-- These are handover checklist entries, not clinical orders or medication tasks.
ALTER TABLE clinical.ipass_items
  ADD COLUMN action_tasks jsonb,
  ADD COLUMN item_revision bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT ipass_action_tasks_array CHECK (action_tasks IS NULL OR jsonb_typeof(action_tasks) = 'array');

-- down
ALTER TABLE clinical.ipass_items DROP CONSTRAINT ipass_action_tasks_array;
ALTER TABLE clinical.ipass_items DROP COLUMN action_tasks, DROP COLUMN item_revision;
