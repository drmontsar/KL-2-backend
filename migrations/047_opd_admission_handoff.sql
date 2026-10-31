-- up
ALTER TABLE clinical.admission_requests ADD COLUMN opd_visit_id uuid REFERENCES opd.visits(id);
CREATE UNIQUE INDEX one_admission_request_per_opd_visit
  ON clinical.admission_requests (opd_visit_id) WHERE opd_visit_id IS NOT NULL;

-- down
DROP INDEX IF EXISTS clinical.one_admission_request_per_opd_visit;
ALTER TABLE clinical.admission_requests DROP COLUMN IF EXISTS opd_visit_id;
