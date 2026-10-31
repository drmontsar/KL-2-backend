import postgres from 'postgres';
import { calculateNews2, type Consciousness } from '../src/clinical/news2';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sql = postgres(process.env.DATABASE_URL);
const rows = await sql<{
  id: string; resp_rate: number; spo2: number; on_supplemental_oxygen: boolean; temperature: number;
  bp_systolic: number; heart_rate: number; consciousness: Consciousness; news2_score: number;
  news2_escalation: string; news2_component_scores: Record<string, number>;
}[]>`
  SELECT id, resp_rate, spo2, on_supplemental_oxygen, temperature, bp_systolic, heart_rate,
         consciousness, news2_score, news2_escalation, news2_component_scores
  FROM clinical.vitals WHERE news2_rule_version = '[DEMO] NEWS2-2017-scale-1'
`;
if (!rows.length) throw new Error('synthetic NEWS2 fixtures were not inserted');
for (const row of rows) {
  const actual = calculateNews2(row);
  if (row.news2_score !== actual.score || row.news2_escalation !== actual.escalation ||
      Object.entries(actual.component_scores).some(([key, value]) => row.news2_component_scores[key] !== value)) {
    throw new Error(`synthetic NEWS2 scoring mismatch for ${row.id}`);
  }
}
const [missing] = await sql<{ count: string }[]>`
  SELECT count(*) AS count FROM clinical.admissions a
  WHERE a.status = 'active' AND NOT EXISTS (SELECT 1 FROM clinical.vitals v WHERE v.admission_id = a.id AND v.news2_score IS NOT NULL)
`;
if (Number(missing.count) !== 0) throw new Error('active admissions still lack NEWS2');
const [fixture] = await sql<{ disabled: boolean }[]>`SELECT disabled_at IS NOT NULL AS disabled FROM staff.users WHERE id = 'd0400000-0000-4000-8000-000000000001'`;
if (!fixture?.disabled) throw new Error('synthetic data generator must not be able to log in');
await sql.end();
console.log(`Synthetic NEWS2 scores verified for ${rows.length} admissions`);
