-- up

ALTER TABLE clinical.alerts
  DROP CONSTRAINT alerts_status_check,
  DROP CONSTRAINT alert_acknowledgement_complete,
  ADD CONSTRAINT alerts_status_check CHECK (status IN ('active','acknowledged','resolved','superseded')),
  ADD COLUMN resolved_by uuid REFERENCES staff.users(id),
  ADD COLUMN resolved_at timestamptz,
  ADD COLUMN resolution_reason text,
  ADD COLUMN superseded_by uuid REFERENCES clinical.alerts(id),
  ADD CONSTRAINT alert_lifecycle_complete CHECK (
    (status = 'active' AND acknowledged_by IS NULL AND acknowledged_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (status = 'resolved' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (status = 'superseded')
  );

CREATE TABLE clinical.observation_schedules (
  admission_id       uuid        PRIMARY KEY REFERENCES clinical.admissions(id) ON DELETE CASCADE,
  frequency_minutes  int         NOT NULL CHECK (frequency_minutes BETWEEN 5 AND 1440),
  next_due_at        timestamptz NOT NULL,
  source             text        NOT NULL CHECK (source IN ('news2_policy','manual')),
  reason             text,
  policy_version     text        NOT NULL,
  updated_by         uuid        REFERENCES staff.users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX observation_schedules_due ON clinical.observation_schedules (next_due_at);

INSERT INTO clinical.observation_schedules
  (admission_id, frequency_minutes, next_due_at, source, policy_version)
SELECT a.id,
       CASE
         WHEN v.recorded_at IS NULL THEN 720
         WHEN v.news2_escalation = 'high' THEN 15
         WHEN v.news2_escalation IN ('medium','low-medium') THEN 60
         WHEN v.news2_score = 0 THEN 720
         ELSE 360
       END,
       CASE WHEN v.recorded_at IS NULL THEN now()
       ELSE v.recorded_at + make_interval(mins => CASE
         WHEN v.news2_escalation = 'high' THEN 15
         WHEN v.news2_escalation IN ('medium','low-medium') THEN 60
         WHEN v.news2_score = 0 THEN 720
         ELSE 360
       END) END,
       'news2_policy',
       'NEWS2-2017-scale-1'
FROM clinical.admissions a
LEFT JOIN LATERAL (
  SELECT recorded_at, news2_score, news2_escalation
  FROM clinical.vitals
  WHERE admission_id = a.id AND news2_score IS NOT NULL
  ORDER BY recorded_at DESC LIMIT 1
) v ON true
WHERE a.status = 'active';

CREATE VIEW clinical.latest_news2 AS
SELECT DISTINCT ON (v.admission_id)
  v.admission_id, v.id AS observation_id, v.recorded_at, v.news2_score,
  v.news2_escalation, v.news2_component_scores, v.news2_rule_version,
  s.frequency_minutes, s.next_due_at,
  CASE WHEN s.next_due_at <= now() THEN 'overdue'
       WHEN s.next_due_at <= now() + interval '30 minutes' THEN 'due'
       ELSE 'scheduled' END AS due_status
FROM clinical.vitals v
LEFT JOIN clinical.observation_schedules s ON s.admission_id = v.admission_id
WHERE v.news2_score IS NOT NULL
ORDER BY v.admission_id, v.recorded_at DESC;

-- down

DROP VIEW IF EXISTS clinical.latest_news2;
DROP TABLE IF EXISTS clinical.observation_schedules;
ALTER TABLE clinical.alerts
  DROP CONSTRAINT IF EXISTS alert_lifecycle_complete,
  DROP COLUMN IF EXISTS superseded_by,
  DROP COLUMN IF EXISTS resolution_reason,
  DROP COLUMN IF EXISTS resolved_at,
  DROP COLUMN IF EXISTS resolved_by,
  DROP CONSTRAINT IF EXISTS alerts_status_check,
  ADD CONSTRAINT alerts_status_check CHECK (status IN ('active','acknowledged')),
  ADD CONSTRAINT alert_acknowledgement_complete CHECK (
    (status = 'active' AND acknowledged_by IS NULL AND acknowledged_at IS NULL)
    OR
    (status = 'acknowledged' AND acknowledged_by IS NOT NULL AND acknowledged_at IS NOT NULL)
  );
