import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { auditLog } from './audit';

export type Admission = {
  id: string;
  patient_id: string;
  status: 'active' | 'discharged';
  severity: 'unstable' | 'watcher' | 'stable';
  ward: string | null;
  bed: string | null;
  bed_id: string | null;
  unit_id: string | null;
  admitted_at: Date;
  discharged_at: Date | null;
  assigned_to: string | null;
  assigned_doctor_id: string | null;
  exit_type: 'discharged' | 'transfer_team' | 'transfer_out' | 'lama' | 'died' | null;
  exit_dest: string | null;
  exit_note: string | null;
  revision: number;
  created_by: string | null;
};

type UserCtx = { id: string; role: string; job_role?: string };

export async function createAdmission(data: {
  patient_id: string;
  ward?: string;
  bed?: string;
  bed_id?: string;
  created_by?: string;
}): Promise<Admission | null> {
  let bedId = data.bed_id;
  if (!bedId && data.ward && data.bed) {
    const matches = await db<{ id: string }[]>`
      SELECT b.id FROM organization.beds b
      JOIN organization.rooms r ON r.id = b.room_id
      JOIN organization.wards w ON w.id = r.ward_id
      WHERE w.name = ${data.ward} AND b.label = ${data.bed}
      LIMIT 2
    `;
    if (matches.length !== 1) return null;
    bedId = matches[0].id;
  }
  if (bedId) {
    const resolvedBedId = bedId;
    return db
      .begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${resolvedBedId}, 0))`;
        const [bed] = await tx<{ id: string; label: string; ward_name: string; unit_id: string }[]>`
        SELECT b.id, b.label, w.name AS ward_name, w.unit_id
        FROM organization.beds b
        JOIN organization.rooms r ON r.id = b.room_id
        JOIN organization.wards w ON w.id = r.ward_id
        WHERE b.id = ${resolvedBedId}
          AND b.operational_state = 'available'
          AND NOT EXISTS (
            SELECT 1 FROM clinical.admissions a
            WHERE a.bed_id = b.id AND a.status = 'active'
          )
          AND NOT EXISTS (
            SELECT 1 FROM organization.bed_reservations r
            WHERE r.bed_id = b.id AND r.released_at IS NULL
          )
      `;
        if (!bed) return null;
        const [row] = await tx<Admission[]>`
        INSERT INTO clinical.admissions (patient_id, ward, bed, bed_id, unit_id, created_by)
        VALUES (${data.patient_id}, ${bed.ward_name}, ${bed.label}, ${bed.id}, ${bed.unit_id}, ${data.created_by ?? null})
        RETURNING *
      `;
        await tx`
        INSERT INTO clinical.bed_assignments (admission_id, bed_id, starts_at, assigned_by)
        VALUES (${row.id}, ${bed.id}, ${row.admitted_at}, ${data.created_by ?? null})
      `;
        await tx`
        INSERT INTO clinical.observation_schedules
          (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
        VALUES (${row.id}, 720, now(), 'news2_policy', 'NEWS2-2017-scale-1', ${data.created_by ?? null})
      `;
        await tx`
        INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
        VALUES (${data.created_by ?? null}, 'create', 'clinical.admissions', ${row.id}, ${tx.json(row)})
      `;
        return row;
      })
      .catch(rethrowDatabaseError);
  }

  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      INSERT INTO clinical.admissions (patient_id, ward, bed, created_by)
      VALUES (${data.patient_id}, ${data.ward ?? null}, ${data.bed ?? null}, ${data.created_by ?? null})
      RETURNING *
    `;
      await tx`
      INSERT INTO clinical.observation_schedules
        (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
      VALUES (${row.id}, 720, now(), 'news2_policy', 'NEWS2-2017-scale-1', ${data.created_by ?? null})
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.created_by ?? null}, 'create', 'clinical.admissions', ${row.id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function moveAdmissionBed(data: {
  admission_id: string;
  bed_id: string;
  expected_revision: number;
  actor_user_id: string;
}): Promise<Admission | null> {
  return db
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${data.bed_id}, 0))`;
      const [admission] = await tx<Admission[]>`
      SELECT * FROM clinical.admissions
      WHERE id = ${data.admission_id} AND status = 'active' AND revision = ${data.expected_revision}
        AND NOT EXISTS (SELECT 1 FROM clinical.patient_movements m WHERE m.admission_id = ${data.admission_id} AND m.status IN ('requested','reserved','in_transit'))
      FOR UPDATE
    `;
      if (!admission || admission.bed_id === data.bed_id) return null;
      const [bed] = await tx<{ id: string; label: string; ward_name: string; unit_id: string }[]>`
      SELECT b.id, b.label, w.name AS ward_name, w.unit_id
      FROM organization.beds b
      JOIN organization.rooms r ON r.id = b.room_id
      JOIN organization.wards w ON w.id = r.ward_id
      WHERE b.id = ${data.bed_id} AND b.operational_state = 'available'
        AND NOT EXISTS (
          SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active'
        )
        AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations r WHERE r.bed_id = b.id AND r.released_at IS NULL)
    `;
      if (!bed) return null;
      await tx`
      UPDATE clinical.bed_assignments SET ends_at = now(), end_reason = 'bed change'
      WHERE admission_id = ${admission.id} AND ends_at IS NULL
    `;
      if (admission.bed_id)
        await tx`UPDATE organization.beds SET operational_state = 'cleaning' WHERE id = ${admission.bed_id}`;
      const [updated] = await tx<Admission[]>`
      UPDATE clinical.admissions
      SET bed_id = ${bed.id}, unit_id = ${bed.unit_id}, ward = ${bed.ward_name},
          bed = ${bed.label}, revision = revision + 1
      WHERE id = ${admission.id} RETURNING *
    `;
      await tx`
      INSERT INTO clinical.bed_assignments (admission_id, bed_id, assigned_by)
      VALUES (${admission.id}, ${bed.id}, ${data.actor_user_id})
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, before, after)
      VALUES (${data.actor_user_id}, 'move_bed', 'clinical.admissions', ${admission.id}, ${tx.json(admission)}, ${tx.json(updated)})
    `;
      return updated;
    })
    .catch(rethrowDatabaseError);
}

export function listActiveAdmissions(opts?: {
  ward?: string;
  assigned_to?: string;
}): Promise<(Admission & { patient_name: string; patient_dob: string })[]> {
  const { ward, assigned_to } = opts ?? {};
  if (ward && assigned_to) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.ward = ${ward} AND a.assigned_to = ${assigned_to}
      ORDER BY a.admitted_at
    `;
  }
  if (ward) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.ward = ${ward}
      ORDER BY a.admitted_at
    `;
  }
  if (assigned_to) {
    return db`
      SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.status = 'active' AND a.assigned_to = ${assigned_to}
      ORDER BY a.admitted_at
    `;
  }
  return db`
    SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.status = 'active'
    ORDER BY a.ward,
             CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END,
             a.admitted_at
  `;
}

export function listAdmissionsByPatient(patient_id: string, user: UserCtx): Promise<Admission[]> {
  return db<Admission[]>`
    SELECT a.* FROM clinical.admissions a
    WHERE a.patient_id = ${patient_id} AND ${admissionAccessFilter(user)}
    ORDER BY a.admitted_at DESC
  `;
}

export async function dischargeAdmission(
  id: string,
  exit: {
    exit_type: 'died' | 'transfer_team';
    exit_dest?: string;
    exit_note?: string;
    actor_user_id: string;
  },
): Promise<Admission | null> {
  if (exit.exit_type !== 'died' && exit.exit_type !== 'transfer_team') return null;
  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      UPDATE clinical.admissions
      SET status        = 'discharged',
          discharged_at = now(),
          exit_type     = ${exit.exit_type},
          exit_dest     = ${exit.exit_dest ?? null},
          exit_note     = ${exit.exit_note ?? null},
          revision      = revision + 1
      WHERE id = ${id} AND status = 'active'
        AND NOT EXISTS (SELECT 1 FROM clinical.patient_movements m WHERE m.admission_id = ${id} AND m.status IN ('requested','reserved','in_transit'))
        AND NOT EXISTS (SELECT 1 FROM clinical.discharge_plans p WHERE p.admission_id = ${id} AND p.status IN ('pending_approval','approved'))
      RETURNING *
    `;
      if (!row) return null;
      await tx`
      UPDATE clinical.bed_assignments
      SET ends_at = ${row.discharged_at}, end_reason = 'discharge'
      WHERE admission_id = ${id} AND ends_at IS NULL
    `;
      if (row.bed_id)
        await tx`UPDATE organization.beds SET operational_state = 'cleaning' WHERE id = ${row.bed_id}`;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${exit.actor_user_id}, 'discharge', 'clinical.admissions', ${id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function assignAdmission(
  id: string,
  nurse_id: string,
  actor_user_id: string,
): Promise<Admission | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      UPDATE clinical.admissions a
      SET assigned_to = ${nurse_id}, revision = a.revision + 1
      FROM staff.users u
      WHERE a.id = ${id} AND a.status = 'active' AND u.id = ${nurse_id}
        AND u.role = 'nurse' AND u.disabled_at IS NULL
        AND (a.unit_id IS NULL OR EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = u.id AND m.unit_id = a.unit_id))
      RETURNING a.*
    `;
      if (!row) return null;
      await tx`
      UPDATE clinical.staff_assignments SET ends_at = clock_timestamp()
      WHERE admission_id = ${id} AND assignment_type = 'primary_nurse' AND user_id <> ${nurse_id} AND ends_at IS NULL
    `;
      await tx`
      INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
      VALUES (${id}, ${nurse_id}, 'primary_nurse', ${actor_user_id}) ON CONFLICT DO NOTHING
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'assign', 'clinical.admissions', ${id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function unassignAdmission(
  id: string,
  actor_user_id: string,
): Promise<Admission | null> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      UPDATE clinical.admissions SET assigned_to = NULL, revision = revision + 1
      WHERE id = ${id} AND status = 'active' RETURNING *
    `;
      if (!row) return null;
      await tx`UPDATE clinical.staff_assignments SET ends_at = clock_timestamp() WHERE admission_id = ${id} AND assignment_type = 'primary_nurse' AND ends_at IS NULL`;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'unassign', 'clinical.admissions', ${id}, ${tx.json(row)})
    `;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function updateAdmission(
  id: string,
  data: { ward?: string; bed?: string; severity?: Admission['severity'] },
  expected_revision: number,
  actor_user_id: string,
): Promise<Admission | null | 'conflict'> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      UPDATE clinical.admissions
      SET
        ward     = COALESCE(${data.ward ?? null}, ward),
        bed      = COALESCE(${data.bed ?? null}, bed),
        severity = COALESCE(${data.severity ?? null}, severity),
        revision = revision + 1
      WHERE id = ${id} AND status = 'active' AND revision = ${expected_revision}
      RETURNING *
    `;
      if (!row) {
        const [exists] = await tx`SELECT 1 FROM clinical.admissions WHERE id = ${id}`;
        return exists ? 'conflict' : null;
      }
      await auditLog(tx, {
        actor_user_id,
        action: 'update',
        record_table: 'clinical.admissions',
        record_id: id,
        after: row,
      });
      return row;
    })
    .catch(rethrowDatabaseError);
}

// Scope fragments use the clinical.admissions alias `a`.
function activeShiftUnitFilter(user_id: string) {
  return db`EXISTS (
    SELECT 1 FROM staff.shifts s
    JOIN staff.shift_units su ON su.shift_id = s.id
    JOIN staff.unit_memberships m ON m.user_id = s.user_id AND m.unit_id = su.unit_id
    WHERE s.user_id = ${user_id} AND s.status = 'active'
      AND now() BETWEEN s.starts_at AND s.ends_at AND su.unit_id = a.unit_id
  )`;
}
export function admissionAccessFilter(user: UserCtx) {
  if (user.job_role === 'administrator' || (!user.job_role && user.role === 'admin'))
    return db`TRUE`;
  return db`(
    EXISTS (
      SELECT 1 FROM clinical.staff_assignments sa
      WHERE sa.admission_id = a.id
        AND sa.user_id = ${user.id}
        AND sa.ends_at IS NULL
        AND sa.assignment_type IN ('treating_consultant', 'duty_doctor')
    )
    OR a.assigned_to = ${user.id}
    OR EXISTS (SELECT 1 FROM clinical.cross_referrals r WHERE r.admission_id = a.id AND r.consultant_id = ${user.id} AND r.status IN ('sent','seen','opinion','acknowledged'))
    OR (${user.role === 'doctor'} AND a.assigned_doctor_id IS NULL AND ${activeShiftUnitFilter(user.id)})
    OR EXISTS (SELECT 1 FROM clinical.break_glass_access bg WHERE bg.admission_id = a.id AND bg.user_id = ${user.id} AND bg.revoked_at IS NULL AND bg.expires_at > now())
  )`;
}

export async function getAdmissionForUser(id: string, user: UserCtx): Promise<Admission | null> {
  const [row] = await db<Admission[]>`
    SELECT a.* FROM clinical.admissions a WHERE a.id = ${id} AND ${admissionAccessFilter(user)}
  `;
  return row ?? null;
}

type ActiveAdmissionRow = Admission & { patient_name: string; patient_dob: string };

const SEVERITY_ORDER = db`CASE a.severity WHEN 'unstable' THEN 0 WHEN 'watcher' THEN 1 ELSE 2 END`;

// Scoped active admission list — scope drives doctor/nurse filtering
export function listAdmissionsForUser(
  user: UserCtx,
  opts?: { scope?: 'mine' | 'open'; ward?: string },
): Promise<ActiveAdmissionRow[]> {
  const { scope, ward } = opts ?? {};
  const base = db`
    SELECT a.*, p.name AS patient_name, p.dob AS patient_dob
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE a.status = 'active'
  `;

  if (user.role === 'doctor' && scope !== 'open') {
    const assigned = db`(
      EXISTS (
        SELECT 1 FROM clinical.staff_assignments sa
        WHERE sa.admission_id = a.id
          AND sa.user_id = ${user.id}
          AND sa.ends_at IS NULL
          AND sa.assignment_type IN ('treating_consultant', 'duty_doctor')
      )
      OR EXISTS (SELECT 1 FROM clinical.cross_referrals r WHERE r.admission_id = a.id AND r.consultant_id = ${user.id} AND r.status IN ('sent','seen','opinion','acknowledged'))
    )`;
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND ${assigned} AND a.ward = ${ward}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND ${assigned}
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  if (scope === 'open' && user.role === 'doctor') {
    const inActiveShiftUnit = activeShiftUnitFilter(user.id);
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND a.assigned_doctor_id IS NULL AND a.ward = ${ward} AND ${inActiveShiftUnit}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND a.assigned_doctor_id IS NULL AND ${inActiveShiftUnit}
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  // nurse scope: their assigned admissions
  if (user.role === 'nurse') {
    if (ward) {
      return db<ActiveAdmissionRow[]>`
        ${base} AND a.assigned_to = ${user.id} AND a.ward = ${ward}
        ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
      `;
    }
    return db<ActiveAdmissionRow[]>`
      ${base} AND a.assigned_to = ${user.id}
      ORDER BY a.ward, ${SEVERITY_ORDER}, a.admitted_at
    `;
  }

  if (user.job_role === 'administrator' || (!user.job_role && user.role === 'admin')) {
    return listActiveAdmissions(ward ? { ward } : undefined);
  }
  return db<ActiveAdmissionRow[]>`${base} AND false`;
}

export async function claimAdmission(
  id: string,
  doctor_id: string,
): Promise<Admission | null | 'already_claimed'> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Admission[]>`
      UPDATE clinical.admissions a
      SET assigned_doctor_id = ${doctor_id}, revision = a.revision + 1
      WHERE a.id = ${id} AND a.status = 'active' AND a.assigned_doctor_id IS NULL
        AND ${activeShiftUnitFilter(doctor_id)}
        AND EXISTS (SELECT 1 FROM staff.users u WHERE u.id = ${doctor_id} AND u.role = 'doctor' AND u.disabled_at IS NULL)
      RETURNING a.*
    `;
      if (!row) {
        const [existing] = await tx`
        SELECT 1 FROM clinical.admissions a WHERE a.id = ${id} AND a.status = 'active'
          AND a.assigned_doctor_id IS NOT NULL
          AND (a.assigned_doctor_id = ${doctor_id} OR ${activeShiftUnitFilter(doctor_id)})
      `;
        return existing ? 'already_claimed' : null;
      }
      await tx`INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
      VALUES (${id}, ${doctor_id}, 'duty_doctor', ${doctor_id}) ON CONFLICT DO NOTHING`;
      await auditLog(tx, {
        action: 'claim',
        record_table: 'clinical.admissions',
        record_id: id,
        actor_user_id: doctor_id,
        after: row,
      });
      return row;
    })
    .catch(rethrowDatabaseError);
}
