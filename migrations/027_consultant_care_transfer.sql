-- up
CREATE UNIQUE INDEX one_active_treating_consultant_per_admission
  ON clinical.staff_assignments (admission_id)
  WHERE assignment_type = 'treating_consultant' AND ends_at IS NULL;

CREATE TABLE clinical.consultant_care_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id uuid NOT NULL REFERENCES clinical.admissions(id),
  requested_by uuid NOT NULL REFERENCES staff.users(id),
  from_consultant_id uuid NOT NULL REFERENCES staff.users(id),
  to_consultant_id uuid NOT NULL REFERENCES staff.users(id),
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  discussed_with_current boolean NOT NULL CHECK (discussed_with_current),
  patient_family_informed boolean NOT NULL CHECK (patient_family_informed),
  status text NOT NULL DEFAULT 'pending_release'
    CHECK (status IN ('pending_release', 'pending_acceptance', 'accepted', 'declined', 'withdrawn')),
  released_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_consultant_id <> to_consultant_id)
);
CREATE UNIQUE INDEX one_open_consultant_care_transfer
  ON clinical.consultant_care_transfers (admission_id)
  WHERE status IN ('pending_release', 'pending_acceptance');
CREATE INDEX consultant_care_transfers_to_status
  ON clinical.consultant_care_transfers (to_consultant_id, status, created_at DESC);
CREATE INDEX consultant_care_transfers_from_status
  ON clinical.consultant_care_transfers (from_consultant_id, status, created_at DESC);

-- down
DROP TABLE IF EXISTS clinical.consultant_care_transfers;
DROP INDEX IF EXISTS clinical.one_active_treating_consultant_per_admission;
