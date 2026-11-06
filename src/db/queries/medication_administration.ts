import { z } from 'zod';
import {
  CatalogItemSchema,
  Dose,
  GiveBodyInput,
  Infusion,
  InfusionBodyInput,
  Review,
  ReviewBodyInput,
  Schedule,
  ScheduleBodyInput,
} from '../../contracts/medication_administration';
import { rethrowDatabaseError } from '../errors';
import { db } from '../index';
import { notifChannel } from './notifications';

type Json = Parameters<(typeof db)['json']>[0];

export async function searchMedicationCatalog(q: string) {
  return db<z.infer<typeof CatalogItemSchema>[]>`
    SELECT * FROM clinical.medication_catalog
    WHERE visible AND (brand ILIKE ${`%${q}%`} OR ingredient ILIKE ${`%${q}%`} OR code ILIKE ${`%${q}%`})
    ORDER BY brand LIMIT 50
  `.catch(rethrowDatabaseError);
}

export async function createMedicationSchedule(
  body: ScheduleBodyInput,
  actor_user_id: string,
  id: string,
) {
  return db
    .begin(async (tx) => {
      const [row] = await tx<Schedule[]>`
        INSERT INTO clinical.medication_schedules (admission_id, order_id, drug, dose, route, prn_indication, prn_min_interval_minutes, prn_max_doses_24h, catalog_id, created_by)
        SELECT o.admission_id, o.id, ${body.drug}, ${body.dose}, ${body.route}, ${body.prn_indication ?? null}, ${body.prn_min_interval_minutes ?? null}, ${body.prn_max_doses_24h ?? null}, ${body.catalog_id ?? null}, ${actor_user_id}
        FROM clinical.orders o JOIN clinical.admissions a ON a.id = o.admission_id AND a.status = 'active'
        WHERE o.id = ${id} AND o.kind = 'medication' AND o.status = 'confirmed'
          AND o.payload->>'drug' = ${body.drug} AND o.payload->>'dose' = ${body.dose} AND o.payload->>'route' = ${body.route}
          AND o.payload->>'catalog_id' IS NOT DISTINCT FROM ${body.catalog_id ?? null}::text
          AND (${body.catalog_id ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM clinical.medication_catalog mc WHERE mc.id = ${body.catalog_id ?? null}::uuid AND mc.brand = ${body.drug}))
          AND o.payload->>'prn_indication' IS NOT DISTINCT FROM ${body.prn_indication ?? null}::text
          AND o.payload->>'prn_min_interval_minutes' IS NOT DISTINCT FROM ${body.prn_min_interval_minutes === undefined ? null : String(body.prn_min_interval_minutes)}::text
          AND o.payload->>'prn_max_doses_24h' IS NOT DISTINCT FROM ${body.prn_max_doses_24h === undefined ? null : String(body.prn_max_doses_24h)}::text
        RETURNING *
      `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'create', 'clinical.medication_schedules', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function listMedicationSchedules(id: string) {
  return db<
    Schedule[]
  >`SELECT * FROM clinical.medication_schedules WHERE admission_id = ${id} ORDER BY created_at DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getMedicationSchedule(id: string) {
  return db<Schedule[]>`SELECT * FROM clinical.medication_schedules WHERE id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function recordAllergyReview(
  id: string,
  body: ReviewBodyInput,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [locked] =
        await tx`SELECT id FROM clinical.medication_schedules WHERE id = ${id} AND active FOR UPDATE`;
      if (!locked) return null;
      const [row] = await tx<Review[]>`
      INSERT INTO clinical.medication_allergy_reviews (schedule_id, patient_revision, decision, reason, reviewed_by)
      SELECT s.id, p.revision, ${body.decision}, ${body.reason}, ${actor_user_id}
      FROM clinical.medication_schedules s JOIN clinical.admissions a ON a.id = s.admission_id
      JOIN clinical.patients p ON p.id = a.patient_id JOIN clinical.orders o ON o.id = s.order_id
      WHERE s.id = ${id} AND s.active AND o.status = 'confirmed' AND a.status = 'active' RETURNING *
    `;
      if (!row) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'allergy_review', 'clinical.medication_allergy_reviews', ${row.id}, ${tx.json(row as unknown as Json)})`;
      return row;
    })
    .catch(rethrowDatabaseError);
}

export async function scheduleMedicationDose(due_at: string, id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [dose] = await tx<Dose[]>`
        INSERT INTO clinical.medication_doses (schedule_id, due_at)
        SELECT s.id, ${due_at}::timestamptz FROM clinical.medication_schedules s
        JOIN clinical.orders o ON o.id = s.order_id JOIN clinical.admissions a ON a.id = s.admission_id
        WHERE s.id = ${id} AND s.active AND o.status = 'confirmed' AND a.status = 'active' RETURNING *
      `;
      if (!dose) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'schedule', 'clinical.medication_doses', ${dose.id}, ${tx.json(dose as unknown as Json)})`;
      return dose;
    })
    .catch(rethrowDatabaseError);
}

export async function preparePrnDose(id: string, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [locked] = await tx<{ id: string }[]>`
      SELECT s.id FROM clinical.medication_schedules s
      JOIN clinical.orders o ON o.id = s.order_id JOIN clinical.admissions a ON a.id = s.admission_id
      WHERE s.id = ${id} AND s.active AND s.prn_indication IS NOT NULL
        AND s.prn_min_interval_minutes IS NOT NULL AND s.prn_max_doses_24h IS NOT NULL
        AND o.status = 'confirmed' AND a.status = 'active' FOR UPDATE OF s
    `;
      if (!locked) return null;
      const [pending] =
        await tx`SELECT id FROM clinical.medication_doses WHERE schedule_id = ${id} AND status = 'scheduled' LIMIT 1`;
      if (pending) return null;
      const [dose] = await tx<
        Dose[]
      >`INSERT INTO clinical.medication_doses (schedule_id, due_at) VALUES (${id}, now()) RETURNING *`;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'prepare_prn', 'clinical.medication_doses', ${dose.id}, ${tx.json(dose as unknown as Json)})`;
      return dose;
    })
    .catch(rethrowDatabaseError);
}

export async function listMedicationDoses(ids: string[]) {
  return db<
    Dose[]
  >`SELECT * FROM clinical.medication_doses WHERE schedule_id IN ${db(ids)} ORDER BY due_at`.catch(
    rethrowDatabaseError,
  );
}

export async function listLatestAllergyReviews(ids: string[]) {
  return db<
    Review[]
  >`SELECT DISTINCT ON (schedule_id) * FROM clinical.medication_allergy_reviews WHERE schedule_id IN ${db(ids)} ORDER BY schedule_id, reviewed_at DESC, id DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function getDoseAdmission(id: string) {
  return db<
    { admission_id: string }[]
  >`SELECT s.admission_id FROM clinical.medication_doses d JOIN clinical.medication_schedules s ON s.id = d.schedule_id WHERE d.id = ${id}`.catch(
    rethrowDatabaseError,
  );
}

export async function giveMedicationDose(id: string, body: GiveBodyInput, actor_user_id: string) {
  return db
    .begin(async (tx) => {
      const [scheduleLock] = await tx`
      SELECT s.id FROM clinical.medication_schedules s
      JOIN clinical.medication_doses d ON d.schedule_id = s.id WHERE d.id = ${id} FOR UPDATE OF s
    `;
      if (!scheduleLock) return null;
      const [locked] = await tx<{ id: string }[]>`
      SELECT d.id FROM clinical.medication_doses d
      JOIN clinical.medication_schedules s ON s.id = d.schedule_id
      JOIN clinical.orders o ON o.id = s.order_id JOIN clinical.admissions a ON a.id = s.admission_id
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE d.id = ${id} AND d.status = 'scheduled' AND d.due_at <= now() + interval '1 hour'
        AND s.active AND o.status = 'confirmed' AND a.status = 'active'
        AND (s.prn_indication IS NULL OR (
          s.prn_min_interval_minutes IS NOT NULL AND s.prn_max_doses_24h IS NOT NULL
          AND ${body.administration_reason ?? null}::text IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM clinical.medication_doses prior WHERE prior.schedule_id = s.id AND prior.status = 'given'
              AND prior.acted_at > now() - make_interval(mins => s.prn_min_interval_minutes)
          )
          AND (SELECT count(*) FROM clinical.medication_doses prior WHERE prior.schedule_id = s.id AND prior.status = 'given'
               AND prior.acted_at > now() - interval '24 hours') < s.prn_max_doses_24h
        ))
        AND p.uhid = ${body.scanned_uhid} AND s.drug = ${body.drug} AND s.dose = ${body.dose} AND s.route = ${body.route}
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.allergies) = 'array' THEN p.allergies ELSE '[]'::jsonb END) allergy
          WHERE nullif(trim(allergy->>'allergen'), '') IS NOT NULL
            AND lower(trim(allergy->>'allergen')) = ANY (ARRAY[lower(s.drug), lower(COALESCE(o.payload->>'generic', '')), lower(COALESCE(o.payload->>'drug_class', ''))])
        )
        AND NOT EXISTS (
          SELECT 1 FROM clinical.medication_catalog_allergens ca,
            jsonb_array_elements(CASE WHEN jsonb_typeof(p.allergies) = 'array' THEN p.allergies ELSE '[]'::jsonb END) allergy
          WHERE ca.medication_id = s.catalog_id AND lower(trim(allergy->>'allergen')) = lower(ca.allergen)
        )
        AND EXISTS (
          SELECT 1 FROM clinical.medication_allergy_reviews review
          WHERE review.id = (SELECT r.id FROM clinical.medication_allergy_reviews r WHERE r.schedule_id = s.id ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 1)
            AND review.patient_revision = p.revision AND review.decision = 'safe'
        )
      FOR UPDATE OF d, s, o, a, p
    `;
      if (!locked) return null;
      const [dose] = await tx<
        Dose[]
      >`UPDATE clinical.medication_doses SET status = 'given', acted_by = ${actor_user_id}, acted_at = now(), administration_reason = ${body.administration_reason ?? null} WHERE id = ${id} AND status = 'scheduled' RETURNING *`;
      if (!dose) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, 'give', 'clinical.medication_doses', ${id}, ${tx.json(dose as unknown as Json)})`;
      return dose;
    })
    .catch(rethrowDatabaseError);
}

export async function recordDoseException(
  action: 'missed' | 'hold',
  actor_user_id: string,
  reason: string,
  id: string,
  admission_id: string,
) {
  return db
    .begin(async (tx) => {
      const [dose] = await tx<Dose[]>`
      UPDATE clinical.medication_doses d SET status = ${action === 'hold' ? 'held' : 'missed'}, acted_by = ${actor_user_id}, acted_at = now(), hold_reason = ${reason}
      FROM clinical.medication_schedules s, clinical.admissions a
      WHERE d.id = ${id} AND d.schedule_id = s.id AND s.admission_id = a.id AND a.status = 'active' AND d.status = 'scheduled'
        AND (${action} <> 'missed' OR d.due_at <= now()) RETURNING d.*
    `;
      if (!dose) return null;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${action}, 'clinical.medication_doses', ${id}, ${tx.json(dose as unknown as Json)})`;
      const notifications = await tx<
        { user_id: string; id: string; type: string; payload: Json; created_at: Date }[]
      >`
        INSERT INTO clinical.notifications (user_id, type, payload)
        SELECT id, ${action === 'hold' ? 'medication.held' : 'medication.missed'}, ${tx.json({ dose_id: id, admission_id: admission_id })}
        FROM staff.users u WHERE u.job_role = 'duty_doctor' AND u.disabled_at IS NULL
          AND EXISTS (SELECT 1 FROM clinical.admissions a JOIN staff.unit_memberships m ON m.unit_id = a.unit_id
            WHERE a.id = ${admission_id} AND m.user_id = u.id) RETURNING *
      `;
      for (const notification of notifications)
        await tx`SELECT pg_notify(${notifChannel(notification.user_id)}, ${JSON.stringify(notification)})`;
      return dose;
    })
    .catch(rethrowDatabaseError);
}

export async function listInfusionEvents(id: string) {
  return db<
    Infusion[]
  >`SELECT * FROM clinical.infusion_events WHERE schedule_id = ${id} ORDER BY recorded_at DESC, id DESC`.catch(
    rethrowDatabaseError,
  );
}

export async function recordInfusionEvent(
  id: string,
  body: InfusionBodyInput,
  actor_user_id: string,
) {
  return db
    .begin(async (tx) => {
      const [locked] = await tx<{ id: string }[]>`
      SELECT s.id FROM clinical.medication_schedules s
      JOIN clinical.orders o ON o.id = s.order_id JOIN clinical.admissions a ON a.id = s.admission_id
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE s.id = ${id} AND a.status = 'active' AND lower(s.route) LIKE '%infusion%'
        AND p.uhid = ${body.scanned_uhid} AND s.drug = ${body.drug} AND s.dose = ${body.dose} AND s.route = ${body.route}
        AND (${body.action} = 'stop' OR (s.active AND o.status = 'confirmed'
          AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.allergies) = 'array' THEN p.allergies ELSE '[]'::jsonb END) allergy
            WHERE nullif(trim(allergy->>'allergen'), '') IS NOT NULL
              AND lower(trim(allergy->>'allergen')) = ANY (ARRAY[lower(s.drug), lower(COALESCE(o.payload->>'generic', '')), lower(COALESCE(o.payload->>'drug_class', ''))])
          )
          AND NOT EXISTS (
            SELECT 1 FROM clinical.medication_catalog_allergens ca,
              jsonb_array_elements(CASE WHEN jsonb_typeof(p.allergies) = 'array' THEN p.allergies ELSE '[]'::jsonb END) allergy
            WHERE ca.medication_id = s.catalog_id AND lower(trim(allergy->>'allergen')) = lower(ca.allergen)
          )
          AND EXISTS (
          SELECT 1 FROM clinical.medication_allergy_reviews review
          WHERE review.id = (SELECT r.id FROM clinical.medication_allergy_reviews r WHERE r.schedule_id = s.id ORDER BY r.reviewed_at DESC, r.id DESC LIMIT 1)
            AND review.patient_revision = p.revision AND review.decision = 'safe'
        )))
      FOR UPDATE OF s, o, a, p
    `;
      if (!locked) return null;
      const [latest] = await tx<
        Infusion[]
      >`SELECT * FROM clinical.infusion_events WHERE schedule_id = ${id} ORDER BY recorded_at DESC, id DESC LIMIT 1`;
      const running = latest && latest.action !== 'stop';
      if ((body.action === 'start' && running) || (body.action !== 'start' && !running))
        return null;
      const [event] = await tx<Infusion[]>`
      INSERT INTO clinical.infusion_events (schedule_id, action, rate, reason, recorded_by)
      VALUES (${id}, ${body.action}, ${body.rate ?? null}, ${body.reason}, ${actor_user_id}) RETURNING *
    `;
      await tx`INSERT INTO clinical.audit_log (actor_user_id, action, record_table, record_id, after) VALUES (${actor_user_id}, ${body.action}, 'clinical.infusion_events', ${event.id}, ${tx.json(event as unknown as Json)})`;
      return event;
    })
    .catch(rethrowDatabaseError);
}
