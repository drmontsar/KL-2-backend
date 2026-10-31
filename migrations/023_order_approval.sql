-- up
ALTER TABLE clinical.orders
  ADD COLUMN requires_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN approval_status text NOT NULL DEFAULT 'not_required'
    CHECK (approval_status IN ('not_required', 'pending', 'approved', 'rejected')),
  ADD COLUMN approval_by uuid REFERENCES staff.users(id),
  ADD COLUMN approval_at timestamptz,
  ADD COLUMN approval_reason text,
  ADD CONSTRAINT order_approval_consistency CHECK (
    (NOT requires_approval AND approval_status = 'not_required' AND approval_by IS NULL AND approval_at IS NULL)
    OR (requires_approval AND approval_status = 'pending' AND approval_by IS NULL AND approval_at IS NULL)
    OR (requires_approval AND approval_status IN ('approved','rejected') AND approval_by IS NOT NULL AND approval_at IS NOT NULL)
  );

-- down
ALTER TABLE clinical.orders DROP CONSTRAINT IF EXISTS order_approval_consistency;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS approval_reason;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS approval_at;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS approval_by;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS approval_status;
ALTER TABLE clinical.orders DROP COLUMN IF EXISTS requires_approval;
