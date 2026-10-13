-- up

CREATE TABLE IF NOT EXISTS clinical.handoffs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id     uuid        NOT NULL REFERENCES clinical.admissions(id),
  requested_by     uuid        NOT NULL REFERENCES staff.users(id),
  assigned_to      uuid        NOT NULL REFERENCES staff.users(id),
  reason           text,
  status           text        NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'acknowledged', 'done')),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid        REFERENCES staff.users(id),
  done_at          timestamptz,
  CONSTRAINT acknowledged_has_actor
    CHECK ((status NOT IN ('acknowledged','done')) OR acknowledged_by IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS handoffs_nurse_pending
  ON clinical.handoffs (assigned_to) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS handoffs_admission
  ON clinical.handoffs (admission_id);

-- down

DROP TABLE IF EXISTS clinical.handoffs;
