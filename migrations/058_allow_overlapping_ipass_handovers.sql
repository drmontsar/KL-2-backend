-- up
-- A patient may appear in multiple unfinished doctor handovers.
DROP INDEX IF EXISTS clinical.ipass_one_pending_item_per_admission;

-- down
-- Rollback fails rather than deleting reviews if overlapping handovers now exist.
CREATE UNIQUE INDEX ipass_one_pending_item_per_admission ON clinical.ipass_items (admission_id)
  WHERE status IN ('draft', 'signed');
