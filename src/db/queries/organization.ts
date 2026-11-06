import { db } from '../index';
import { rethrowDatabaseError } from '../errors';
import { admissionAccessFilter } from './admissions';
import type { User } from './users';

export type Facility = { id: string; code: string; name: string; created_at: Date };
export type Department = {
  id: string;
  facility_id: string;
  code: string;
  name: string;
  created_at: Date;
};
export type Unit = {
  id: string;
  department_id: string;
  code: string;
  name: string;
  kind: 'inpatient' | 'icu' | 'emergency' | 'opd' | 'procedure';
  created_at: Date;
};
export type Ward = { id: string; unit_id: string; name: string; created_at: Date };
export type Room = { id: string; ward_id: string; name: string; created_at: Date };
export type Bed = {
  id: string;
  room_id: string;
  room_name: string;
  ward_id: string;
  ward_name: string;
  label: string;
  operational_state: 'available' | 'cleaning' | 'out_of_service';
  occupancy: 'available' | 'occupied' | 'reserved' | 'cleaning' | 'out_of_service';
};
export type CensusEntry = Bed & {
  admission_id: string;
  patient_id: string;
  patient_name: string;
  severity: 'unstable' | 'watcher' | 'stable';
  assigned_doctor_id: string | null;
  assigned_to: string | null;
  arrival_status: 'incoming' | 'admitted';
};

export function listFacilities(): Promise<Facility[]> {
  return db<Facility[]>`SELECT * FROM organization.facilities ORDER BY name`;
}

export function listDepartments(facility_id?: string): Promise<Department[]> {
  return facility_id
    ? db<
        Department[]
      >`SELECT * FROM organization.departments WHERE facility_id = ${facility_id} ORDER BY name`
    : db<Department[]>`SELECT * FROM organization.departments ORDER BY name`;
}

export function listUnits(facility_id?: string): Promise<Unit[]> {
  return facility_id
    ? db<Unit[]>`
        SELECT u.* FROM organization.units u
        JOIN organization.departments d ON d.id = u.department_id
        WHERE d.facility_id = ${facility_id}
        ORDER BY u.name
      `
    : db<Unit[]>`SELECT * FROM organization.units ORDER BY name`;
}

export function listWards(unit_id?: string): Promise<Ward[]> {
  return unit_id
    ? db<Ward[]>`SELECT * FROM organization.wards WHERE unit_id = ${unit_id} ORDER BY name`
    : db<Ward[]>`SELECT * FROM organization.wards ORDER BY name`;
}

export function listRooms(ward_id?: string): Promise<Room[]> {
  return ward_id
    ? db<Room[]>`SELECT * FROM organization.rooms WHERE ward_id = ${ward_id} ORDER BY name`
    : db<Room[]>`SELECT * FROM organization.rooms ORDER BY name`;
}

export function listBeds(opts: {
  ward_id?: string;
  occupancy?: Bed['occupancy'];
}): Promise<Bed[]> {
  const occupancy = db`
    CASE
      WHEN b.operational_state <> 'available' THEN b.operational_state
      WHEN a.arrival_status = 'incoming' THEN 'reserved'
      WHEN a.id IS NOT NULL THEN 'occupied'
      WHEN EXISTS (SELECT 1 FROM organization.bed_reservations br WHERE br.bed_id = b.id AND br.released_at IS NULL) THEN 'reserved'
      ELSE 'available'
    END
  `;
  const base = db`
    SELECT b.id, b.room_id, r.name AS room_name, w.id AS ward_id, w.name AS ward_name,
           b.label, b.operational_state, ${occupancy} AS occupancy
    FROM organization.beds b
    JOIN organization.rooms r ON r.id = b.room_id
    JOIN organization.wards w ON w.id = r.ward_id
    LEFT JOIN clinical.admissions a ON a.bed_id = b.id AND a.status = 'active'
    WHERE true
  `;
  if (opts.ward_id && opts.occupancy) {
    return db<
      Bed[]
    >`${base} AND w.id = ${opts.ward_id} AND ${occupancy} = ${opts.occupancy} ORDER BY w.name, r.name, b.label`;
  }
  if (opts.ward_id) {
    return db<Bed[]>`${base} AND w.id = ${opts.ward_id} ORDER BY w.name, r.name, b.label`;
  }
  if (opts.occupancy) {
    return db<Bed[]>`${base} AND ${occupancy} = ${opts.occupancy} ORDER BY w.name, r.name, b.label`;
  }
  return db<Bed[]>`${base} ORDER BY w.name, r.name, b.label`;
}

export async function updateBedOperationalState(
  id: string,
  operational_state: Bed['operational_state'],
  actor_user_id: string,
): Promise<Bed | null> {
  const updated = await db
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
      const [row] = await tx<{ id: string }[]>`
      UPDATE organization.beds b SET operational_state = ${operational_state}
      WHERE b.id = ${id}
        AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
        AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations r WHERE r.bed_id = b.id AND r.released_at IS NULL)
      RETURNING b.id
    `;
      if (row)
        await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'update_operational_state', 'organization.beds', ${id}, ${tx.json({ operational_state })})`;
      return row;
    })
    .catch(rethrowDatabaseError);
  if (!updated) return null;
  const rows = await listBeds({});
  return rows.find((bed) => bed.id === id) ?? null;
}

export function listWardCensus(ward_id: string, user: User): Promise<CensusEntry[]> {
  const base = db`
    SELECT b.id, b.room_id, r.name AS room_name, w.id AS ward_id, w.name AS ward_name,
           b.label, b.operational_state,
           CASE WHEN a.arrival_status = 'incoming' THEN 'reserved' ELSE 'occupied' END AS occupancy,
           a.id AS admission_id, a.patient_id, p.name AS patient_name, a.severity, a.arrival_status,
           a.assigned_doctor_id, a.assigned_to
    FROM organization.beds b
    JOIN organization.rooms r ON r.id = b.room_id
    JOIN organization.wards w ON w.id = r.ward_id
    JOIN clinical.admissions a ON a.bed_id = b.id AND a.status = 'active'
    JOIN clinical.patients p ON p.id = a.patient_id
    WHERE w.id = ${ward_id}
  `;
  if (user.role === 'doctor' || user.role === 'nurse') {
    return db<CensusEntry[]>`${base} AND ${admissionAccessFilter(user)} ORDER BY b.label`;
  }
  if (user.job_role === 'administrator') {
    return db<CensusEntry[]>`${base} ORDER BY b.label`;
  }
  if (user.job_role === 'bed_desk') {
    return db<CensusEntry[]>`
      ${base} AND EXISTS (
        SELECT 1 FROM staff.unit_memberships m
        WHERE m.user_id = ${user.id} AND m.unit_id = w.unit_id
      )
      ORDER BY b.label
    `;
  }
  return db<CensusEntry[]>`${base} AND false`;
}
