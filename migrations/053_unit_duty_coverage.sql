-- up

-- Shift choice is informational for now; it does not restrict clinical access.
ALTER TABLE staff.sessions ADD COLUMN selected_shift text
  CHECK (selected_shift IN ('morning', 'afternoon', 'night'));

-- Retain historical duty assignments but close them; admissions belong to consultants,
-- not individual duty doctors. Keep consultant and nurse assignments intact.
UPDATE clinical.staff_assignments SET ends_at = GREATEST(clock_timestamp(), starts_at + interval '1 microsecond')
WHERE assignment_type = 'duty_doctor' AND ends_at IS NULL;
UPDATE clinical.admissions SET assigned_doctor_id = NULL WHERE assigned_doctor_id IS NOT NULL;
UPDATE clinical.transfer_requests SET status = 'rejected', resolved_at = now() WHERE status = 'pending';

-- down
ALTER TABLE staff.sessions DROP COLUMN IF EXISTS selected_shift;
-- Historical per-patient duty assignments cannot be reconstructed automatically.
