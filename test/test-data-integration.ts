import postgres from 'postgres';
import { calculateNews2, type Consciousness } from '../src/clinical/news2';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(process.env.DATABASE_URL);
try {
  const patients = await sql<{ id: string; name: string; uhid: string }[]>`
    SELECT id, name, uhid FROM clinical.patients
    WHERE id IN ('13000000-0000-4000-8000-000000000001', '13000000-0000-4000-8000-000000000002', '13000000-0000-4000-8000-000000000003', '13000000-0000-4000-8000-000000000004') ORDER BY id
  `;
  if (patients.length !== 4 || patients[0].name !== 'Ananya Sharma Updated' || patients[0].uhid !== 'UH-90000001') {
    throw new Error('Portable seed did not preserve an edited patient or restore stable identifiers');
  }
  if (patients.some((patient) => patient.name.includes('[DEMO]'))) throw new Error('Fixture patient names must not contain demo tags');
  const vitals = await sql<{
    resp_rate: number; spo2: number; on_supplemental_oxygen: boolean; temperature: number; bp_systolic: number; heart_rate: number;
    consciousness: Consciousness; news2_score: number; news2_escalation: string; news2_component_scores: Record<string, number>;
  }[]>`SELECT * FROM clinical.vitals WHERE id IN ('14000000-0000-4000-8000-000000000401','14000000-0000-4000-8000-000000000402')`;
  if (vitals.length !== 2) throw new Error('Portable seed is missing NEWS2 observations');
  for (const vital of vitals) {
    const result = calculateNews2(vital);
    if (vital.news2_score !== result.score || vital.news2_escalation !== result.escalation || Object.entries(result.component_scores).some(([key, value]) => vital.news2_component_scores[key] !== value)) {
      throw new Error('Portable seed has inconsistent NEWS2 data');
    }
  }
  const [complete] = await sql<{ ok: boolean }[]>`
    SELECT
      EXISTS (SELECT 1 FROM clinical.admissions WHERE id = '14000000-0000-4000-8000-000000000001')
      AND EXISTS (SELECT 1 FROM clinical.nursing_assessments WHERE id = '15000000-0000-4000-8000-000000000001')
      AND EXISTS (SELECT 1 FROM clinical.medication_schedules WHERE id = '14000000-0000-4000-8000-000000000901')
      AND EXISTS (SELECT 1 FROM opd.visits WHERE id = '15000000-0000-4000-8000-000000000019')
      AND EXISTS (SELECT 1 FROM forms.instance_versions WHERE id = '15000000-0000-4000-8000-000000000021')
      AND EXISTS (SELECT 1 FROM finance.claims WHERE id = '15000000-0000-4000-8000-000000000008')
      AND EXISTS (SELECT 1 FROM clinical.ipass_items WHERE id = '15000000-0000-4000-8000-000000000023')
      AND EXISTS (SELECT 1 FROM clinical.nurse_handover_items WHERE id = '15000000-0000-4000-8000-000000000025') AS ok
  `;
  if (!complete.ok) throw new Error('Portable seed is missing a workflow fixture');
  console.log('Portable test-data fresh database, collision rollback, idempotence, and NEWS2 checks passed');
} finally {
  await sql.end();
}
