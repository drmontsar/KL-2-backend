-- up
CREATE TABLE opd.dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid NOT NULL REFERENCES opd.visits(id),
  kind text NOT NULL CHECK (kind IN ('pharmacy','collection')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  completed_by uuid REFERENCES staff.users(id),
  UNIQUE (visit_id, kind),
  CHECK ((status = 'pending' AND completed_at IS NULL AND completed_by IS NULL)
      OR (status = 'completed' AND completed_at IS NOT NULL AND completed_by IS NOT NULL))
);
CREATE INDEX opd_dispatches_pending ON opd.dispatches (kind, created_at) WHERE status = 'pending';

-- down
DROP TABLE IF EXISTS opd.dispatches;
