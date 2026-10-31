import { db } from '../index';
import { admissionAccessFilter } from './admissions';
import type { User } from './users';

export type WardSummary = {
  news_critical: number;
  news_warning: number;
  stat_orders: number;
  pending_orders: number;
  active_shifts: number;
  unsigned_handovers: number;
  tpa_queries: number;
  master_warnings: number;
  master_cautions: number;
  claim_data_visible: boolean;
};

export type HeaderSummary = {
  admission_id: string;
  patient: {
    id: string;
    name: string;
    uhid: string;
    age: number;
    sex: 'male' | 'female' | 'other' | 'unknown' | null;
    allergies: { allergen: string; reaction?: string; severity?: 'mild' | 'moderate' | 'severe' }[];
  };
  bed: { id: string | null; label: string | null; ward: string | null; unit_id: string | null };
  news2: {
    score: number;
    escalation: 'low' | 'low-medium' | 'medium' | 'high' | null;
    recorded_at: string;
    component_scores: Record<string, number> | null;
    rule_version: string | null;
  } | null;
  consultant: { id: string; name: string; specialty: string | null } | null;
  assigned_doctor: { id: string; name: string } | null;
  assigned_nurse: { id: string; name: string } | null;
  payer: { id: string; name: string } | null;
  claim: {
    id: string;
    status: string;
    current_usage: string;
    approved_limit: string;
    currency: string;
  } | null;
  claim_data_visible: boolean;
  counts: {
    pending_orders: number;
    stat_orders: number;
    active_alerts: number;
    active_referrals: number;
    active_shifts: number;
    unsigned_handovers: number;
    tpa_queries: number;
    pending_discharge_tasks: number;
  };
};

export async function getCensusCards(ids: string[], user: User) {
  return db<
    {
      admission_id: string;
      dob: string;
      sex: string | null;
      has_allergies: boolean;
      diagnosis: string | null;
      doctor_name: string | null;
      scores: number[];
      open_alerts: number;
    }[]
  >`
    SELECT a.id AS admission_id, p.dob::text AS dob, p.sex,
      jsonb_array_length(COALESCE(p.allergies::jsonb, '[]'::jsonb)) > 0 AS has_allergies,
      (SELECT d.description FROM clinical.diagnoses d WHERE d.patient_id = p.id AND d.status = 'active' ORDER BY d.diagnosed_at DESC LIMIT 1) AS diagnosis,
      u.name AS doctor_name,
      ARRAY(SELECT v.news2_score FROM clinical.vitals v WHERE v.admission_id = a.id AND v.news2_score IS NOT NULL ORDER BY v.recorded_at DESC, v.event_order DESC LIMIT 6) AS scores,
      (SELECT count(*)::int FROM clinical.alerts al WHERE al.admission_id = a.id AND al.status IN ('active', 'acknowledged')) AS open_alerts
    FROM clinical.admissions a
    JOIN clinical.patients p ON p.id = a.patient_id
    LEFT JOIN staff.users u ON u.id = a.assigned_doctor_id
    WHERE a.id = ANY(${db.array(ids)}::uuid[]) AND ${admissionAccessFilter(user)}
  `;
}

export async function getWardSummary(unitId: string, user: User): Promise<WardSummary | null> {
  const claimVisible = user.role === 'doctor' || user.job_role === 'administrator';
  const [row] = await db<{ data: WardSummary }[]>`
    WITH authorized_unit AS (
      SELECT u.id FROM organization.units u
      WHERE u.id = ${unitId} AND (
        ${user.job_role === 'administrator'}
        OR EXISTS (SELECT 1 FROM staff.unit_memberships m WHERE m.user_id = ${user.id} AND m.unit_id = u.id)
        OR EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.unit_id = u.id AND a.status = 'active' AND ${admissionAccessFilter(user)})
      )
    ), scoped AS (
      SELECT a.id, a.assigned_doctor_id FROM clinical.admissions a
      JOIN authorized_unit u ON u.id = a.unit_id
      WHERE a.status = 'active' AND ${admissionAccessFilter(user)}
    ), counts AS (
      SELECT
        (SELECT count(*)::int FROM scoped a JOIN clinical.latest_news2 n ON n.admission_id = a.id WHERE n.news2_score >= 7) AS news_critical,
        (SELECT count(*)::int FROM scoped a JOIN clinical.latest_news2 n ON n.admission_id = a.id WHERE n.news2_score < 7 AND (n.news2_score >= 5 OR n.news2_escalation = 'low-medium')) AS news_warning,
        (SELECT count(*)::int FROM scoped a JOIN clinical.orders o ON o.admission_id = a.id WHERE o.status = 'confirmed' AND o.acknowledged_at IS NULL AND o.priority = 'stat') AS stat_orders,
        (SELECT count(*)::int FROM scoped a JOIN clinical.orders o ON o.admission_id = a.id WHERE o.status = 'confirmed' AND o.acknowledged_at IS NULL) AS pending_orders,
        (SELECT count(*)::int FROM scoped a JOIN clinical.patient_movements m ON m.admission_id = a.id WHERE m.status IN ('requested','reserved','in_transit')) AS active_shifts,
        (SELECT count(*)::int FROM scoped a WHERE a.assigned_doctor_id IS NOT NULL
          AND (${user.job_role === 'administrator'} OR a.assigned_doctor_id = ${user.id})
          AND NOT EXISTS (
            SELECT 1 FROM clinical.ipass_items i JOIN clinical.ipass_sessions s ON s.id = i.session_id
            WHERE i.admission_id = a.id AND s.outgoing_doctor_id = a.assigned_doctor_id
              AND s.status IN ('draft','sent') AND i.status = 'signed'
          )) AS unsigned_handovers,
        (SELECT count(*)::int FROM scoped a JOIN finance.claims f ON f.admission_id = a.id WHERE ${claimVisible} AND f.status = 'query_raised') AS tpa_queries,
        (SELECT count(*)::int FROM scoped a JOIN clinical.alerts al ON al.admission_id = a.id WHERE al.status = 'active' AND al.severity = 'warning') AS warning_alerts,
        (SELECT count(*)::int FROM scoped a JOIN clinical.alerts al ON al.admission_id = a.id WHERE al.status = 'active' AND al.severity = 'caution') AS caution_alerts
    )
    SELECT json_build_object(
      'news_critical', c.news_critical, 'news_warning', c.news_warning,
      'stat_orders', c.stat_orders, 'pending_orders', c.pending_orders, 'active_shifts', c.active_shifts,
      'unsigned_handovers', c.unsigned_handovers, 'tpa_queries', c.tpa_queries,
      'master_warnings', c.warning_alerts + c.stat_orders,
      'master_cautions', c.caution_alerts + c.tpa_queries + c.unsigned_handovers,
      'claim_data_visible', ${claimVisible}
    ) AS data FROM authorized_unit u CROSS JOIN counts c
  `;
  return row?.data ?? null;
}

export async function getHeaderSummary(
  admissionId: string,
  user: User,
): Promise<HeaderSummary | null> {
  const claimVisible = user.role === 'doctor' || user.job_role === 'administrator';
  const [row] = await db<{ data: HeaderSummary }[]>`
    WITH scoped AS (
      SELECT a.* FROM clinical.admissions a WHERE a.id = ${admissionId} AND ${admissionAccessFilter(user)}
    )
    SELECT json_build_object(
      'admission_id', a.id,
      'patient', json_build_object('id', p.id, 'name', p.name, 'uhid', p.uhid,
        'age', EXTRACT(YEAR FROM age(current_date, p.dob))::int, 'sex', p.sex, 'allergies', p.allergies),
      'bed', json_build_object('id', a.bed_id, 'label', a.bed, 'ward', a.ward, 'unit_id', a.unit_id),
      'news2', CASE WHEN n.observation_id IS NULL THEN NULL ELSE json_build_object(
        'score', n.news2_score, 'escalation', n.news2_escalation, 'recorded_at', n.recorded_at,
        'component_scores', n.news2_component_scores, 'rule_version', n.news2_rule_version) END,
      'consultant', CASE WHEN consultant.id IS NULL THEN NULL ELSE json_build_object('id', consultant.id, 'name', consultant.name, 'specialty', consultant.specialization) END,
      'assigned_doctor', CASE WHEN doctor.id IS NULL THEN NULL ELSE json_build_object('id', doctor.id, 'name', doctor.name) END,
      'assigned_nurse', CASE WHEN nurse.id IS NULL THEN NULL ELSE json_build_object('id', nurse.id, 'name', nurse.name) END,
      'payer', CASE WHEN coverage.id IS NULL THEN NULL ELSE json_build_object('id', coverage.id, 'name', coverage.payer_name) END,
      'claim', CASE WHEN ${claimVisible} AND claim.id IS NOT NULL THEN json_build_object(
        'id', claim.id, 'status', claim.status, 'current_usage', claim.current_usage::text,
        'approved_limit', claim.approved_limit::text, 'currency', claim.currency) ELSE NULL END,
      'claim_data_visible', ${claimVisible},
      'counts', json_build_object(
        'pending_orders', (SELECT count(*)::int FROM clinical.orders o WHERE o.admission_id = a.id AND o.status = 'confirmed' AND o.acknowledged_at IS NULL),
        'stat_orders', (SELECT count(*)::int FROM clinical.orders o WHERE o.admission_id = a.id AND o.status = 'confirmed' AND o.acknowledged_at IS NULL AND o.priority = 'stat'),
        'active_alerts', (SELECT count(*)::int FROM clinical.alerts al WHERE al.admission_id = a.id AND al.status = 'active'),
        'active_referrals', (SELECT count(*)::int FROM clinical.cross_referrals r WHERE r.admission_id = a.id AND r.status IN ('sent','seen','opinion','acknowledged')),
        'active_shifts', (SELECT count(*)::int FROM clinical.patient_movements m WHERE m.admission_id = a.id AND m.status IN ('requested','reserved','in_transit')),
        'unsigned_handovers', CASE WHEN a.assigned_doctor_id IS NOT NULL
          AND (${user.job_role === 'administrator'} OR a.assigned_doctor_id = ${user.id}) AND a.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM clinical.ipass_items i JOIN clinical.ipass_sessions s ON s.id = i.session_id
            WHERE i.admission_id = a.id AND s.outgoing_doctor_id = a.assigned_doctor_id AND s.status IN ('draft','sent') AND i.status = 'signed')
          THEN 1 ELSE 0 END,
        'tpa_queries', CASE WHEN ${claimVisible} AND claim.status = 'query_raised' THEN 1 ELSE 0 END,
        'pending_discharge_tasks', (SELECT count(*)::int FROM clinical.discharge_tasks t JOIN clinical.discharge_plans dp ON dp.id = t.plan_id
          WHERE dp.admission_id = a.id AND dp.status IN ('pending_approval','approved') AND t.status = 'pending')
      )
    ) AS data
    FROM scoped a JOIN clinical.patients p ON p.id = a.patient_id
    LEFT JOIN clinical.latest_news2 n ON n.admission_id = a.id
    LEFT JOIN staff.users doctor ON doctor.id = a.assigned_doctor_id
    LEFT JOIN staff.users nurse ON nurse.id = a.assigned_to
    LEFT JOIN LATERAL (
      SELECT u.id, u.name, u.specialization FROM clinical.staff_assignments sa
      JOIN staff.users u ON u.id = sa.user_id
      WHERE sa.admission_id = a.id AND sa.assignment_type = 'treating_consultant' AND sa.ends_at IS NULL
      ORDER BY sa.starts_at DESC, sa.id DESC LIMIT 1
    ) consultant ON true
    LEFT JOIN finance.claims claim ON claim.admission_id = a.id AND ${claimVisible}
    LEFT JOIN LATERAL (
      SELECT pc.id, pc.payer_name FROM clinical.patient_coverage pc WHERE pc.patient_id = p.id
      ORDER BY (pc.id = claim.coverage_id) DESC NULLS LAST, pc.is_primary DESC, pc.created_at DESC LIMIT 1
    ) coverage ON true
  `;
  return row?.data ?? null;
}
