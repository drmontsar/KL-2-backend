import { CreateBodyInput, Movement } from '../../contracts/patient_movements';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import type { User } from './users';

type Json = Parameters<(typeof db)['json']>[0];

export async function requestPatientMovement(body: CreateBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [admission] = await tx<{ bed_id: string | null; news2_score: number | null }[]>`
        SELECT a.bed_id, n.news2_score FROM clinical.admissions a
        LEFT JOIN clinical.latest_news2 n ON n.admission_id = a.id
        WHERE a.id = ${body.admission_id} AND a.status = 'active' FOR UPDATE OF a
      `;
      if (
        !admission?.bed_id ||
        admission.news2_score === null ||
        (admission.news2_score >= 5 && body.escort === 'porter')
      )
        return null;
      const [row] = await tx<Movement[]>`
        INSERT INTO clinical.patient_movements (admission_id, movement_type, destination_unit_id, destination_area, source_bed_id, reason, escort, equipment, requested_by)
        VALUES (${body.admission_id}, ${body.movement_type}, ${body.movement_type === 'permanent' ? body.destination_unit_id : null},
          ${body.movement_type === 'temporary' ? body.destination_area : null}, ${admission.bed_id}, ${body.reason}, ${body.escort}, ${tx.json(body.equipment)}, ${actor_user_id}) RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'request', 'clinical.patient_movements', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listAdmissionMovements(id: string) {
  return db<
    Movement[]
  >`SELECT * FROM clinical.patient_movements WHERE admission_id = ${id} ORDER BY requested_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function reserveMovementBed(bed_id: string, id: string, user: User) {
  return db
    .begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${bed_id}, 0))`;
      const [movement] = await tx<
        Movement[]
      >`SELECT * FROM clinical.patient_movements WHERE id = ${id} AND movement_type = 'permanent' AND status = 'requested' FOR UPDATE`;
      if (!movement || movement.source_bed_id === bed_id) return null;
      const [bed] = await tx<{ id: string }[]>`
        SELECT b.id FROM organization.beds b JOIN organization.rooms r ON r.id = b.room_id JOIN organization.wards w ON w.id = r.ward_id
        WHERE b.id = ${bed_id} AND w.unit_id = ${movement.destination_unit_id} AND b.operational_state = 'available'
          AND (${user.job_role === 'administrator'} OR EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.unit_id = w.unit_id AND m.user_id = ${user.id}))
          AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
          AND NOT EXISTS (SELECT 1 FROM organization.bed_reservations br WHERE br.bed_id = b.id AND br.released_at IS NULL)
      `;
      if (!bed) return null;
      await tx`INSERT INTO organization.bed_reservations (bed_id, movement_id, reserved_by) VALUES (${bed_id}, ${id}, ${user.id})`;
      const [row] = await tx<
        Movement[]
      >`UPDATE clinical.patient_movements SET destination_bed_id = ${bed_id}, status = 'reserved', reserved_by = ${user.id} WHERE id = ${id} RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${user.id}, 'reserve', 'clinical.patient_movements', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function getPatientMovement(id: string) {
  return db<Movement[]>`SELECT * FROM clinical.patient_movements WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function transitionPatientMovement(
  id: string,
  action: 'depart' | 'arrive' | 'return' | 'cancel',
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [movement] = await tx<
        Movement[]
      >`SELECT * FROM clinical.patient_movements WHERE id = ${id} FOR UPDATE`;
      if (!movement) return null;
      const [admission] = await tx<
        { id: string; bed_id: string | null; news2_score: number | null }[]
      >`
        SELECT a.id, a.bed_id, n.news2_score FROM clinical.admissions a LEFT JOIN clinical.latest_news2 n ON n.admission_id = a.id
        WHERE a.id = ${movement.admission_id} AND a.status = 'active' FOR UPDATE OF a
      `;
      if (!admission || admission.bed_id !== movement.source_bed_id) return null;
      if (action === 'depart') {
        if (
          (movement.movement_type === 'permanent' && movement.status !== 'reserved') ||
          (movement.movement_type === 'temporary' && movement.status !== 'requested') ||
          admission.news2_score === null ||
          (admission.news2_score >= 5 && movement.escort === 'porter')
        )
          return null;
      } else if (action === 'arrive') {
        if (
          movement.movement_type !== 'permanent' ||
          movement.status !== 'in_transit' ||
          !movement.destination_bed_id
        )
          return null;
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${movement.destination_bed_id}, 0))`;
        const [bed] = await tx<{ id: string; label: string; ward_name: string; unit_id: string }[]>`
          SELECT b.id, b.label, w.name AS ward_name, w.unit_id FROM organization.beds b
          JOIN organization.rooms r ON r.id = b.room_id JOIN organization.wards w ON w.id = r.ward_id
          JOIN organization.bed_reservations br ON br.bed_id = b.id AND br.movement_id = ${id} AND br.released_at IS NULL
          WHERE b.id = ${movement.destination_bed_id} AND b.operational_state = 'available'
            AND NOT EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
        `;
        if (!bed) return null;
        await tx`UPDATE clinical.bed_assignments SET ends_at = now(), end_reason = 'patient movement' WHERE admission_id = ${admission.id} AND ends_at IS NULL`;
        await tx`UPDATE clinical.admissions SET bed_id = ${bed.id}, unit_id = ${bed.unit_id}, ward = ${bed.ward_name}, bed = ${bed.label}, revision = revision + 1 WHERE id = ${admission.id}`;
        await tx`INSERT INTO clinical.bed_assignments (admission_id, bed_id, assigned_by) VALUES (${admission.id}, ${bed.id}, ${actor_user_id})`;
        await tx`UPDATE organization.bed_reservations SET released_at = now() WHERE movement_id = ${id} AND released_at IS NULL`;
        await tx`UPDATE organization.beds SET operational_state = 'cleaning' WHERE id = ${movement.source_bed_id}`;
      } else if (action === 'return') {
        if (movement.movement_type !== 'temporary' || movement.status !== 'in_transit') return null;
      } else {
        if (!['requested', 'reserved'].includes(movement.status)) return null;
        await tx`UPDATE organization.bed_reservations SET released_at = now() WHERE movement_id = ${id} AND released_at IS NULL`;
      }
      const status =
        action === 'depart'
          ? 'in_transit'
          : action === 'arrive'
            ? 'arrived'
            : action === 'return'
              ? 'returned'
              : 'cancelled';
      const [row] = await tx<Movement[]>`
        UPDATE clinical.patient_movements SET status = ${status},
          departed_at = CASE WHEN ${action} = 'depart' THEN now() ELSE departed_at END,
          completed_at = CASE WHEN ${action} <> 'depart' THEN now() ELSE completed_at END
        WHERE id = ${id} RETURNING *
      `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${action}, 'clinical.patient_movements', ${id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}
