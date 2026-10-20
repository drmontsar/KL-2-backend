-- up
CREATE TABLE clinical.transfer_requests (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id   uuid        NOT NULL REFERENCES clinical.admissions(id),
  from_doctor_id uuid        NOT NULL REFERENCES staff.users(id),
  to_doctor_id   uuid        NOT NULL REFERENCES staff.users(id),
  status         text        NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'accepted', 'rejected')),
  message        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

CREATE INDEX transfer_requests_to_doctor   ON clinical.transfer_requests (to_doctor_id)   WHERE status = 'pending';
CREATE INDEX transfer_requests_from_doctor ON clinical.transfer_requests (from_doctor_id) WHERE status = 'pending';

-- down
DROP TABLE IF EXISTS clinical.transfer_requests;
