import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { auditLog } from './audit';

export type UnitMembership = {
  user_id: string;
  unit_id: string;
  is_primary: boolean;
  created_at: Date;
};

export type StaffShift = {
  id: string;
  user_id: string;
  starts_at: Date;
  ends_at: Date;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  created_by: string | null;
  created_at: Date;
  unit_ids: string[];
};

export type StaffAssignment = {
  id: string;
  admission_id: string;
  user_id: string;
  assignment_type: 'treating_consultant' | 'duty_doctor' | 'primary_nurse' | 'coverage';
  starts_at: Date;
  ends_at: Date | null;
  assigned_by: string | null;
};

export function listUnitMemberships(user_id: string): Promise<UnitMembership[]> {
  return db<UnitMembership[]>`
    SELECT * FROM staff.unit_memberships WHERE user_id = ${user_id} ORDER BY is_primary DESC, created_at
  `;
}

export async function replaceUnitMemberships(
  user_id: string,
  units: { unit_id: string; is_primary: boolean }[],
  actor_user_id: string,
): Promise<UnitMembership[]> {
  return db
    .begin(async (tx) => {
      await tx`DELETE FROM staff.unit_memberships WHERE user_id = ${user_id}`;
      for (const unit of units) {
        await tx`
        INSERT INTO staff.unit_memberships (user_id, unit_id, is_primary)
        VALUES (${user_id}, ${unit.unit_id}, ${unit.is_primary})
      `;
      }
      const rows = await tx<UnitMembership[]>`
      SELECT * FROM staff.unit_memberships WHERE user_id = ${user_id} ORDER BY is_primary DESC, created_at
    `;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${actor_user_id}, 'replace_unit_memberships', 'staff.users', ${user_id}, ${tx.json(rows)})
    `;
      return rows;
    })
    .catch(rethrowDatabaseError);
}

export function listShifts(opts: { user_id?: string; status?: StaffShift['status'] }): Promise<
  StaffShift[]
> {
  const base = db`
    SELECT s.*, COALESCE(array_agg(su.unit_id) FILTER (WHERE su.unit_id IS NOT NULL), '{}') AS unit_ids
    FROM staff.shifts s
    LEFT JOIN staff.shift_units su ON su.shift_id = s.id
    WHERE true
  `;
  if (opts.user_id && opts.status) {
    return db<
      StaffShift[]
    >`${base} AND s.user_id = ${opts.user_id} AND s.status = ${opts.status} GROUP BY s.id ORDER BY s.starts_at DESC`;
  }
  if (opts.user_id) {
    return db<
      StaffShift[]
    >`${base} AND s.user_id = ${opts.user_id} GROUP BY s.id ORDER BY s.starts_at DESC`;
  }
  if (opts.status) {
    return db<
      StaffShift[]
    >`${base} AND s.status = ${opts.status} GROUP BY s.id ORDER BY s.starts_at DESC`;
  }
  return db<StaffShift[]>`${base} GROUP BY s.id ORDER BY s.starts_at DESC`;
}

export async function createShift(data: {
  user_id: string;
  starts_at: Date;
  ends_at: Date;
  unit_ids: string[];
  created_by: string;
}): Promise<StaffShift | null> {
  return db
    .begin(async (tx) => {
      const memberships = await tx<{ unit_id: string }[]>`
      SELECT unit_id FROM staff.unit_memberships
      WHERE user_id = ${data.user_id} AND unit_id IN ${tx(data.unit_ids)}
    `;
      if (memberships.length !== data.unit_ids.length) return null;
      const [shift] = await tx<StaffShift[]>`
      INSERT INTO staff.shifts (user_id, starts_at, ends_at, created_by)
      VALUES (${data.user_id}, ${data.starts_at}, ${data.ends_at}, ${data.created_by})
      RETURNING *, ARRAY[]::uuid[] AS unit_ids
    `;
      for (const unitId of data.unit_ids) {
        await tx`INSERT INTO staff.shift_units (shift_id, unit_id) VALUES (${shift.id}, ${unitId})`;
      }
      shift.unit_ids = data.unit_ids;
      await tx`
      INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after)
      VALUES (${data.created_by}, 'create', 'staff.shifts', ${shift.id}, ${tx.json(shift)})
    `;
      return shift;
    })
    .catch(rethrowDatabaseError);
}

export async function transitionShift(
  id: string,
  user_id: string,
  next: 'active' | 'completed' | 'cancelled',
  is_admin: boolean,
): Promise<StaffShift | null> {
  return db
    .begin(async (tx) => {
      const allowedCurrent =
        next === 'active' ? ['scheduled'] : next === 'completed' ? ['active'] : ['scheduled'];
      const [row] = await tx<StaffShift[]>`
      UPDATE staff.shifts s
      SET status = ${next}
      WHERE s.id = ${id}
        AND (${is_admin} OR s.user_id = ${user_id})
        AND s.status IN ${tx(allowedCurrent)}
      RETURNING s.*, ARRAY(SELECT su.unit_id FROM staff.shift_units su WHERE su.shift_id = s.id) AS unit_ids
    `;
      if (row) {
        await auditLog(tx, {
          action: `shift_${next}`,
          record_table: 'staff.shifts',
          record_id: id,
          actor_user_id: user_id,
          after: row,
        });
      }
      return row ?? null;
    })
    .catch(rethrowDatabaseError);
}

export function listStaffAssignments(admission_id: string): Promise<StaffAssignment[]> {
  return db<StaffAssignment[]>`
    SELECT * FROM clinical.staff_assignments
    WHERE admission_id = ${admission_id} AND ends_at IS NULL
    ORDER BY starts_at
  `;
}

export async function createStaffAssignment(data: {
  admission_id: string;
  user_id: string;
  assignment_type: StaffAssignment['assignment_type'];
  assigned_by: string;
}): Promise<StaffAssignment | null> {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${data.admission_id} AND status = 'active' FOR UPDATE`;
      if (!admission) return null;
      const [row] = await tx<StaffAssignment[]>`
      INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
      SELECT ${data.admission_id}, u.id, ${data.assignment_type}, ${data.assigned_by}
      FROM staff.users u JOIN clinical.admissions a ON a.id = ${data.admission_id}
      WHERE u.id = ${data.user_id} AND u.disabled_at IS NULL
        AND (
          (${data.assignment_type} = 'treating_consultant' AND u.job_role = 'consultant')
          OR (${data.assignment_type} IN ('duty_doctor','coverage') AND u.role = 'doctor')
          OR (${data.assignment_type} = 'primary_nurse' AND u.role = 'nurse')
        )
        AND (${data.assignment_type} <> 'primary_nurse' OR a.assigned_to IS NULL OR a.assigned_to = u.id)
        AND (${data.assignment_type} <> 'duty_doctor' OR a.assigned_doctor_id IS NULL OR a.assigned_doctor_id = u.id)
        AND EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = u.id AND m.unit_id = a.unit_id)
      ON CONFLICT DO NOTHING RETURNING *
    `;
      if (!row) return null;
      if (data.assignment_type === 'primary_nurse') {
        await tx`UPDATE clinical.admissions SET assigned_to = ${data.user_id}, revision = revision + 1 WHERE id = ${data.admission_id} AND assigned_to IS NULL`;
      } else if (data.assignment_type === 'duty_doctor') {
        await tx`UPDATE clinical.admissions SET assigned_doctor_id = ${data.user_id}, revision = revision + 1 WHERE id = ${data.admission_id} AND assigned_doctor_id IS NULL`;
      }
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${data.assigned_by}, 'assign_staff', 'clinical.staff_assignments', ${row.id}, ${tx.json(row)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function endStaffAssignment(
  id: string,
  admission_id: string,
  actor_user_id: string,
): Promise<StaffAssignment | null> {
  return db
    .begin(async (tx) => {
      const [admission] =
        await tx`SELECT id FROM clinical.admissions WHERE id = ${admission_id} FOR UPDATE`;
      if (!admission) return null;
      const [row] = await tx<StaffAssignment[]>`
      UPDATE clinical.staff_assignments SET ends_at = clock_timestamp()
      WHERE id = ${id} AND admission_id = ${admission_id} AND ends_at IS NULL RETURNING *
    `;
      if (!row) return null;
      if (row.assignment_type === 'primary_nurse') {
        await tx`UPDATE clinical.admissions SET assigned_to = NULL, revision = revision + 1 WHERE id = ${admission_id} AND status = 'active' AND assigned_to = ${row.user_id}`;
      } else if (row.assignment_type === 'duty_doctor') {
        await tx`UPDATE clinical.admissions SET assigned_doctor_id = NULL, revision = revision + 1 WHERE id = ${admission_id} AND status = 'active' AND assigned_doctor_id = ${row.user_id}`;
      }
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'end_assignment', 'clinical.staff_assignments', ${row.id}, ${tx.json(row)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function grantBreakGlass(data: {
  user_id: string;
  admission_id: string;
  reason: string;
}): Promise<{ id: string; expires_at: Date }> {
  return db
    .begin(async (tx) => {
      const [row] = await tx<{ id: string; expires_at: Date }[]>`
      INSERT INTO clinical.break_glass_access (user_id, admission_id, reason, expires_at)
      VALUES (${data.user_id}, ${data.admission_id}, ${data.reason}, now() + interval '60 minutes')
      RETURNING id, expires_at
    `;
      await auditLog(tx, {
        action: 'break_glass',
        record_table: 'clinical.admissions',
        record_id: data.admission_id,
        actor_user_id: data.user_id,
        after: { reason: data.reason, expires_at: row.expires_at },
      });
      return row;
    })
    .catch(rethrowDatabaseError);
}
