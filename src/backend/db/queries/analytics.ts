import { db } from '../index';

export type SeverityBreakdown = {
  unstable: number;
  watcher: number;
  stable: number;
};

export type WardCount = {
  ward: string;
  count: number;
};

export type LengthOfStayRow = {
  admission_id: string;
  patient_name: string;
  ward: string | null;
  bed: string | null;
  days: number;
};

export type VitalsAlertRow = {
  admission_id: string;
  patient_name: string;
  ward: string | null;
  bed: string | null;
  flags: string[];
};

export type DoctorAnalytics = {
  total_active: number;
  severity: SeverityBreakdown;
  by_ward: WardCount[];
  nurse_coverage: { assigned: number; unassigned: number };
  length_of_stay: LengthOfStayRow[];
  vitals_alerts: VitalsAlertRow[];
  pending_tasks_total: number;
};

// Normal ranges used for vitals alert flags
const RANGES = {
  spo2_low:      'v.spo2 < 94',
  hr_high:       'v.heart_rate > 100',
  hr_low:        'v.heart_rate < 50',
  bp_systolic_high: 'v.bp_systolic > 160',
  bp_systolic_low:  'v.bp_systolic < 90',
  temp_high:     'v.temperature > 38.5',
  temp_low:      'v.temperature < 36.0',
  glucose_high:  'v.glucose > 200',
  glucose_low:   'v.glucose < 70',
};

export async function getDoctorAnalytics(doctor_id: string): Promise<DoctorAnalytics> {
  const [result] = await db`
    WITH active AS (
      SELECT
        a.id,
        a.severity,
        a.ward,
        a.bed,
        a.assigned_to,
        a.admitted_at,
        p.name AS patient_name
      FROM clinical.admissions a
      JOIN clinical.patients p ON p.id = a.patient_id
      WHERE a.assigned_doctor_id = ${doctor_id}
        AND a.status = 'active'
    ),

    severity_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE severity = 'unstable') AS unstable,
        COUNT(*) FILTER (WHERE severity = 'watcher')  AS watcher,
        COUNT(*) FILTER (WHERE severity = 'stable')   AS stable,
        COUNT(*)                                       AS total
      FROM active
    ),

    ward_counts AS (
      SELECT
        COALESCE(ward, 'Unknown') AS ward,
        COUNT(*)::int             AS count
      FROM active
      GROUP BY ward
      ORDER BY count DESC
    ),

    nurse_coverage AS (
      SELECT
        COUNT(*) FILTER (WHERE assigned_to IS NOT NULL) AS assigned,
        COUNT(*) FILTER (WHERE assigned_to IS NULL)     AS unassigned
      FROM active
    ),

    los AS (
      SELECT
        id          AS admission_id,
        patient_name,
        ward,
        bed,
        GREATEST(1, EXTRACT(DAY FROM now() - admitted_at)::int) AS days
      FROM active
      ORDER BY days DESC
    ),

    latest_vitals AS (
      SELECT DISTINCT ON (v.admission_id)
        v.admission_id,
        v.spo2,
        v.heart_rate,
        v.bp_systolic,
        v.temperature,
        v.glucose
      FROM clinical.vitals v
      WHERE v.admission_id IN (SELECT id FROM active)
      ORDER BY v.admission_id, v.recorded_at DESC
    ),

    vitals_flagged AS (
      SELECT
        v.admission_id,
        a.patient_name,
        a.ward,
        a.bed,
        array_remove(ARRAY[
          CASE WHEN ${db.unsafe(RANGES.spo2_low)}           THEN 'spo2_low'           END,
          CASE WHEN ${db.unsafe(RANGES.hr_high)}            THEN 'hr_high'            END,
          CASE WHEN ${db.unsafe(RANGES.hr_low)}             THEN 'hr_low'             END,
          CASE WHEN ${db.unsafe(RANGES.bp_systolic_high)}   THEN 'bp_systolic_high'   END,
          CASE WHEN ${db.unsafe(RANGES.bp_systolic_low)}    THEN 'bp_systolic_low'    END,
          CASE WHEN ${db.unsafe(RANGES.temp_high)}          THEN 'temp_high'          END,
          CASE WHEN ${db.unsafe(RANGES.temp_low)}           THEN 'temp_low'           END,
          CASE WHEN ${db.unsafe(RANGES.glucose_high)}       THEN 'glucose_high'       END,
          CASE WHEN ${db.unsafe(RANGES.glucose_low)}        THEN 'glucose_low'        END
        ], NULL) AS flags
      FROM latest_vitals v
      JOIN active a ON a.id = v.admission_id
    ),

    pending_tasks AS (
      SELECT COUNT(*)::int AS total
      FROM clinical.tasks t
      WHERE t.admission_id IN (SELECT id FROM active)
        AND t.status = 'pending'
    )

    SELECT
      json_build_object(
        'total_active',        sc.total,
        'severity',            json_build_object('unstable', sc.unstable, 'watcher', sc.watcher, 'stable', sc.stable),
        'by_ward',             (SELECT json_agg(json_build_object('ward', ward, 'count', count)) FROM ward_counts),
        'nurse_coverage',      json_build_object('assigned', nc.assigned, 'unassigned', nc.unassigned),
        'length_of_stay',      (SELECT json_agg(json_build_object('admission_id', admission_id, 'patient_name', patient_name, 'ward', ward, 'bed', bed, 'days', days)) FROM los),
        'vitals_alerts',       (SELECT json_agg(json_build_object('admission_id', admission_id, 'patient_name', patient_name, 'ward', ward, 'bed', bed, 'flags', flags)) FROM vitals_flagged WHERE array_length(flags, 1) > 0),
        'pending_tasks_total', pt.total
      ) AS data
    FROM severity_counts sc, nurse_coverage nc, pending_tasks pt
  `;

  const data = result.data as DoctorAnalytics;
  // Ensure nulls become empty arrays
  data.vitals_alerts   = data.vitals_alerts   ?? [];
  data.length_of_stay  = data.length_of_stay  ?? [];
  data.by_ward         = data.by_ward         ?? [];
  return data;
}
