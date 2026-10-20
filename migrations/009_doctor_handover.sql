-- up

CREATE TABLE IF NOT EXISTS clinical.handover_sessions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outgoing_doctor_id uuid        NOT NULL REFERENCES staff.users(id),
  incoming_doctor_id uuid        NOT NULL REFERENCES staff.users(id),
  ward               text,
  status             text        NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);

CREATE INDEX IF NOT EXISTS handover_sessions_outgoing ON clinical.handover_sessions (outgoing_doctor_id);
CREATE INDEX IF NOT EXISTS handover_sessions_incoming ON clinical.handover_sessions (incoming_doctor_id);

CREATE TABLE IF NOT EXISTS clinical.handover_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES clinical.handover_sessions(id) ON DELETE CASCADE,
  admission_id uuid        NOT NULL REFERENCES clinical.admissions(id),
  snapshot     jsonb       NOT NULL,
  item_version int         NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS handover_items_session ON clinical.handover_items (session_id);

CREATE TABLE IF NOT EXISTS clinical.handover_acknowledgments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id         uuid        NOT NULL REFERENCES clinical.handover_items(id) ON DELETE CASCADE,
  item_version    int         NOT NULL,
  acknowledged_by uuid        NOT NULL REFERENCES staff.users(id),
  notes           text,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, acknowledged_by)
);

-- down

DROP TABLE IF EXISTS clinical.handover_acknowledgments;
DROP TABLE IF EXISTS clinical.handover_items;
DROP TABLE IF EXISTS clinical.handover_sessions;
