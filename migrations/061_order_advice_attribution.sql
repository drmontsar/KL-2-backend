-- up
-- The placing clinician is already recorded in orders.created_by.
-- Advice is recorded separately; legacy orders remain unattributed rather than inferred.
ALTER TABLE clinical.orders ADD COLUMN advised_by uuid REFERENCES staff.users(id);
COMMENT ON COLUMN clinical.orders.advised_by IS 'Clinician whose advice was recorded by the ordering clinician; not an authorization or signature by the advisor';

-- down
ALTER TABLE clinical.orders DROP COLUMN advised_by;
