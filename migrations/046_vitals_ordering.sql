-- up
ALTER TABLE clinical.vitals ADD COLUMN event_order bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX vitals_admission_order ON clinical.vitals (admission_id, recorded_at DESC, event_order DESC);

CREATE OR REPLACE VIEW clinical.latest_news2 AS
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
ORDER BY v.admission_id, v.recorded_at DESC, v.event_order DESC;

-- down
CREATE OR REPLACE VIEW clinical.latest_news2 AS
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
DROP INDEX IF EXISTS clinical.vitals_admission_order;
ALTER TABLE clinical.vitals DROP COLUMN IF EXISTS event_order;
