-- up

ALTER TABLE clinical.vitals
  ALTER COLUMN spo2 TYPE double precision USING spo2::double precision,
  ALTER COLUMN temperature TYPE double precision USING temperature::double precision,
  ADD COLUMN on_supplemental_oxygen boolean,
  ADD COLUMN consciousness text CHECK (consciousness IN ('alert','confusion','voice','pain','unresponsive')),
  ADD COLUMN news2_score int CHECK (news2_score BETWEEN 0 AND 20),
  ADD COLUMN news2_escalation text CHECK (news2_escalation IN ('low','low-medium','medium','high')),
  ADD COLUMN news2_component_scores jsonb,
  ADD COLUMN news2_rule_version text;

CREATE TABLE clinical.alerts (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  admission_id     uuid        NOT NULL REFERENCES clinical.admissions(id),
  source_vitals_id uuid        UNIQUE REFERENCES clinical.vitals(id),
  type             text        NOT NULL CHECK (type IN ('news2')),
  severity         text        NOT NULL CHECK (severity IN ('caution','warning')),
  message          text        NOT NULL,
  status           text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','acknowledged')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_by  uuid        REFERENCES staff.users(id),
  acknowledged_at  timestamptz,
  CONSTRAINT alert_acknowledgement_complete CHECK (
    (status = 'active' AND acknowledged_by IS NULL AND acknowledged_at IS NULL)
    OR
    (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
  )
);

CREATE INDEX alerts_admission_status
  ON clinical.alerts (admission_id, status, created_at DESC);

-- down

DROP TABLE IF EXISTS clinical.alerts;
ALTER TABLE clinical.vitals
  DROP COLUMN IF EXISTS news2_rule_version,
  DROP COLUMN IF EXISTS news2_component_scores,
  DROP COLUMN IF EXISTS news2_escalation,
  DROP COLUMN IF EXISTS news2_score,
  DROP COLUMN IF EXISTS consciousness,
  DROP COLUMN IF EXISTS on_supplemental_oxygen,
  ALTER COLUMN spo2 TYPE numeric(4,1) USING spo2::numeric(4,1),
  ALTER COLUMN temperature TYPE numeric(4,1) USING temperature::numeric(4,1);
