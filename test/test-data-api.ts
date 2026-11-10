import { emailForFixturePhone } from './demo_login';

const baseUrl = process.env.BASE_URL;
if (!baseUrl) throw new Error('BASE_URL is required');

async function get(path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}
async function login(phone: string): Promise<string> {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailForFixturePhone(phone), password: 'password' }),
  });
  if (!response.ok) throw new Error(`Fixture login returned ${response.status}`);
  return (await response.json() as { token: string }).token;
}

const doctor = await login('+1 202 555 0111');
const nurse = await login('+1 202 555 0113');
const bruce = await login('1112223330');
const bruceAdmissions = await get('/admissions?scope=mine', bruce) as { id: string }[];
const sampleIds = ['14000000-0000-4000-8000-000000000001', '14000000-0000-4000-8000-000000000002'];
if (!sampleIds.every((id) => bruceAdmissions.some((admission) => admission.id === id))) {
  throw new Error('Dr. Bruce Wayne cannot see the portable admissions');
}
const bruceWard = await get('/dashboard/ward-summary?unit_id=10000000-0000-4000-8000-000000000003', bruce) as { news_warning: number; pending_orders: number; tpa_queries: number };
if (bruceWard.news_warning !== 1 || bruceWard.pending_orders !== 3 || bruceWard.tpa_queries !== 1) throw new Error('Dr. Bruce Wayne ward data is incomplete');
const header = await get('/admissions/14000000-0000-4000-8000-000000000001/header-summary', doctor) as {
  patient: { name: string; uhid: string }; news2: { score: number }; claim: { current_usage: string };
};
if (header.patient.name !== 'Ananya Sharma' || header.patient.uhid !== 'UH-90000001' || header.news2?.score !== 6 || header.claim?.current_usage !== '12500.00') {
  throw new Error('Portable fixture patient header is incomplete');
}
const ward = await get('/dashboard/ward-summary?unit_id=10000000-0000-4000-8000-000000000003', doctor) as {
  news_warning: number; pending_orders: number; tpa_queries: number;
};
if (ward.news_warning !== 1 || ward.pending_orders !== 3 || ward.tpa_queries !== 1) throw new Error('Portable fixture ward summary is incorrect');
const mar = await get('/admissions/14000000-0000-4000-8000-000000000001/mar', nurse) as unknown[];
if (mar.length !== 1) throw new Error('Portable fixture MAR is missing');
const opd = await get('/opd/queue', doctor) as { id: string }[];
if (!opd.some((visit) => visit.id === '15000000-0000-4000-8000-000000000019')) throw new Error('Portable fixture OPD visit is missing');
const forms = await get('/forms/patients/13000000-0000-4000-8000-000000000001/instances', doctor) as unknown[];
if (!forms.length) throw new Error('Portable fixture form is missing');
const catalog = await get('/medication-catalog', doctor) as { brand: string }[];
if (!catalog.some((item) => item.brand === 'Paracetamol 500 mg') || catalog.some((item) => item.brand.includes('Demo '))) throw new Error('Medication catalogue contains legacy display names');
const templates = await get('/forms/templates', doctor) as { name: string }[];
if (!templates.some((item) => item.name === 'General consent for admission and treatment') || templates.some((item) => item.name.includes('[DEMO]'))) throw new Error('Form library contains legacy display names');
const diagnoses = await get('/opd/diagnoses', doctor) as { code: string }[];
if (!diagnoses.some((item) => item.code === 'R50.9') || diagnoses.some((item) => item.code.startsWith('DEMO-'))) throw new Error('Diagnosis library contains legacy display codes');
console.log('Portable test-data API visibility checks passed');
