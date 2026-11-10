/**
 * Destructive fixture setup for scripts/test-integration.sh only.
 */
import postgres from 'postgres';
import { config } from '../../../src/config';
import { logger } from '../../../src/logger';
import { demoEmail } from '../../../src/db/demo_email';
import { hashPassword } from '../../../src/security/password';

if (process.env.NODE_ENV !== 'test' || process.env.DISPOSABLE_DATABASE !== '1') {
  throw new Error('Legacy fixtures require a disposable integration-test database');
}

const db = postgres(config.databaseUrl);

// ── Fixed user IDs (stable across re-seeds) ──────────────────────────────────
// Demo phones: Dr. Harrington +44 7700 900321 | Dr. Patel +44 7700 900322 | Dr. Chen +44 7700 900323
// Nurse: Sarah Mitchell +44 7700 900654 | Admin: Alex Morgan +44 7700 900999

const DOCTOR_ID  = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'; // Dr. James Harrington
const DOCTOR_ID2 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'; // Dr. Priya Patel
const DOCTOR_ID3 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'; // Dr. Wei Chen
const NURSE_ID   = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
const ADMIN_ID   = 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33';

// ── Name pools ────────────────────────────────────────────────────────────────

const MALE_FIRST = [
  'James',
  'William',
  'Oliver',
  'Noah',
  'Henry',
  'Ethan',
  'Lucas',
  'Benjamin',
  'Jack',
  'Daniel',
  'Michael',
  'Thomas',
  'George',
  'Charles',
  'Alexander',
  'Edward',
  'Harry',
  'Robert',
  'Andrew',
  'Christopher',
  'Matthew',
  'David',
  'Joseph',
  'Samuel',
  'Nicholas',
  'Patrick',
  'Richard',
  'Jonathan',
  'Timothy',
  'Stephen',
  'Gregory',
  'Brian',
  'Kevin',
  'Mark',
  'Anthony',
  'Steven',
  'Joshua',
  'Kenneth',
  'Eric',
  'Jeffrey',
  'Scott',
  'Ryan',
  'Brandon',
  'Adam',
  'Aaron',
  'Tyler',
  'Nathan',
  'Justin',
  'Kyle',
  'Peter',
];
const FEMALE_FIRST = [
  'Emily',
  'Emma',
  'Charlotte',
  'Sophia',
  'Olivia',
  'Amelia',
  'Isabella',
  'Mia',
  'Eleanor',
  'Grace',
  'Evelyn',
  'Hannah',
  'Victoria',
  'Lily',
  'Sophie',
  'Alice',
  'Lucy',
  'Clara',
  'Catherine',
  'Elizabeth',
  'Margaret',
  'Jennifer',
  'Rebecca',
  'Rachel',
  'Sarah',
  'Laura',
  'Anna',
  'Julia',
  'Nicole',
  'Natalie',
  'Kate',
  'Amanda',
  'Michelle',
  'Patricia',
  'Christine',
  'Sandra',
  'Helen',
  'Carol',
  'Donna',
  'Lisa',
  'Ashley',
  'Jessica',
  'Samantha',
  'Alexandra',
  'Diana',
  'Claire',
  'Audrey',
  'Frances',
  'Beatrice',
];
const LAST = [
  'Smith',
  'Johnson',
  'Williams',
  'Brown',
  'Jones',
  'Davis',
  'Miller',
  'Wilson',
  'Moore',
  'Taylor',
  'Anderson',
  'Thomas',
  'Jackson',
  'White',
  'Harris',
  'Martin',
  'Thompson',
  'Clark',
  'Lewis',
  'Lee',
  'Walker',
  'Hall',
  'Allen',
  'Young',
  'King',
  'Wright',
  'Hill',
  'Scott',
  'Green',
  'Adams',
  'Baker',
  'Nelson',
  'Carter',
  'Mitchell',
  'Roberts',
  'Turner',
  'Phillips',
  'Campbell',
  'Parker',
  'Evans',
  'Edwards',
  'Collins',
  'Stewart',
  'Morris',
  'Rogers',
  'Reed',
  'Cook',
  'Morgan',
  'Bell',
  'Murphy',
  'Bailey',
  'Rivera',
  'Cooper',
  'Richardson',
  'Cox',
  'Howard',
  'Ward',
  'Torres',
  'Peterson',
];
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const WARDS = [
  'Cardiology',
  'Neurology',
  'Orthopedics',
  'Respiratory',
  'General Medicine',
  'ICU',
];
const WARD_PREFIX: Record<string, string> = {
  Cardiology: 'C',
  Neurology: 'N',
  Orthopedics: 'O',
  Respiratory: 'R',
  'General Medicine': 'G',
  ICU: 'I',
};

// ── Diagnoses by ward ─────────────────────────────────────────────────────────

const DIAGNOSES: Record<string, string[]> = {
  Cardiology: [
    'Atrial Fibrillation',
    'Hypertensive Heart Disease',
    'Acute Coronary Syndrome',
    'Congestive Heart Failure',
    'Aortic Stenosis',
  ],
  Neurology: [
    'Ischemic Stroke',
    'Migraine with Aura',
    'Epileptic Seizure',
    'Multiple Sclerosis Relapse',
    'Parkinson Disease',
  ],
  Orthopedics: [
    'Hip Fracture',
    'Lumbar Disc Herniation',
    'Osteoarthritis — Knee',
    'Post-op Total Knee Replacement',
    'Rotator Cuff Tear',
  ],
  Respiratory: [
    'Community Acquired Pneumonia',
    'COPD Exacerbation',
    'Pulmonary Embolism',
    'Asthma Exacerbation',
    'Pleural Effusion',
  ],
  'General Medicine': [
    'Type 2 Diabetes — Poor Control',
    'Uncontrolled Hypertension',
    'Acute Gastroenteritis',
    'Iron Deficiency Anaemia',
    'Cellulitis',
  ],
  ICU: [
    'Septic Shock',
    'Acute Respiratory Distress Syndrome',
    'Multi-organ Failure',
    'Post-cardiac Arrest Care',
    'Severe Pancreatitis',
  ],
};

// ── Orders payload templates ──────────────────────────────────────────────────

const MED_ORDERS = [
  { drug: 'Metoprolol', dose: '50mg', route: 'oral', frequency: 'twice daily' },
  { drug: 'Aspirin', dose: '75mg', route: 'oral', frequency: 'once daily' },
  { drug: 'Atorvastatin', dose: '40mg', route: 'oral', frequency: 'at night' },
  { drug: 'Warfarin', dose: '5mg', route: 'oral', frequency: 'once daily' },
  { drug: 'Lisinopril', dose: '10mg', route: 'oral', frequency: 'once daily' },
  { drug: 'Furosemide', dose: '40mg', route: 'oral', frequency: 'twice daily' },
  {
    drug: 'Amoxicillin',
    dose: '500mg',
    route: 'oral',
    frequency: 'three times daily',
  },
  {
    drug: 'Pantoprazole',
    dose: '40mg',
    route: 'oral',
    frequency: 'once daily',
  },
  {
    drug: 'Morphine',
    dose: '10mg',
    route: 'IV',
    frequency: 'as needed for pain',
  },
  {
    drug: 'Paracetamol',
    dose: '1g',
    route: 'oral',
    frequency: 'four times daily',
  },
];
const INVEST_ORDERS = [
  { test: 'Chest X-Ray' },
  { test: '12-lead ECG' },
  { test: 'Full Blood Count' },
  { test: 'Liver Function Tests' },
  { test: 'Renal Profile' },
  { test: 'CT Head without contrast' },
  { test: 'Echocardiogram' },
  { test: 'D-Dimer' },
  { test: 'Troponin Levels' },
  { test: 'Blood Cultures ×2' },
];
const NURSING_ORDERS = [
  { instruction: 'Neurological observations every 2 hours' },
  { instruction: 'Blood pressure monitoring 4-hourly' },
  { instruction: 'Strict fluid balance charting' },
  { instruction: 'Wound dressing change daily' },
  { instruction: 'Mobilise twice daily with physiotherapy' },
  { instruction: 'Pressure area care 2-hourly' },
];
const NOTE_BODIES = [
  'Patient reviewed on ward round. Vitals stable. Continue current management. Plan: repeat bloods in 24h, physiotherapy consult requested.',
  'Reviewed overnight. Comfortable at rest, mild exertional dyspnoea. O2 sats 95% on room air. Plan: increase Furosemide, repeat CXR tomorrow.',
  'Post-procedure review. Patient tolerating diet. No signs of complication. Wound clean and dry. Discharge planning initiated.',
  'Family meeting held. Goals of care discussed. Patient wishes documented. Palliative care team to review.',
  'Acute deterioration noted at 02:00. Rapid response team called. Patient stabilised. IV access secured, IV fluids commenced.',
  'Neurology review requested. Awaiting specialist input. MRI Brain ordered. Patient comfortable, no further seizures since admission.',
  'Occupational therapy assessment completed. Home modifications required prior to discharge. Social work referral made.',
  'Imaging reviewed with radiology. Plan confirmed. Consent obtained for procedure tomorrow. Patient and family counselled.',
];

// ── Utility helpers ───────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function pickN<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
function rand(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function daysAgo(n: number) {
  return new Date(Date.now() - n * 86400_000);
}
function hoursAgo(n: number) {
  return new Date(Date.now() - n * 3600_000);
}

const ALLERGENS = [
  { allergen: 'Penicillin', severity: 'severe' },
  { allergen: 'Sulfonamides', severity: 'moderate' },
  { allergen: 'Latex', severity: 'mild' },
  { allergen: 'Ibuprofen', severity: 'moderate' },
  { allergen: 'Shellfish', severity: 'mild' },
  { allergen: 'Aspirin', severity: 'severe' },
  { allergen: 'Codeine', severity: 'mild' },
  { allergen: 'Contrast dye', severity: 'severe' },
];

// ── Main seed ─────────────────────────────────────────────────────────────────

logger.info('Seeding database');

// 1 — Clear all clinical data (FK order matters)
await db`TRUNCATE staff.shifts, staff.unit_memberships,
         clinical.audit_log, clinical.handoffs, clinical.vitals,
         clinical.tasks, clinical.orders,
         clinical.amendments, clinical.note_versions, clinical.notes,
         clinical.diagnoses, clinical.admissions, clinical.patients CASCADE`;

// 2 — Upsert users
await db`
  INSERT INTO staff.users (id, name, role, job_role, registration_number, specialization, phone)
  VALUES
    (${DOCTOR_ID},  'Dr. James Harrington', 'doctor', 'duty_doctor', 'GMC-7842301', 'General & Internal Medicine', '+44 7700 900321'),
    (${DOCTOR_ID2}, 'Dr. Priya Patel',      'doctor', 'consultant',  'GMC-9134502', 'Cardiology',                  '+44 7700 900322'),
    (${DOCTOR_ID3}, 'Dr. Wei Chen',         'doctor', 'duty_doctor', 'GMC-6250873', 'Neurology',                   '+44 7700 900323'),
    (${NURSE_ID},   'Sarah Mitchell RN',    'nurse',  'staff_nurse', 'NMC-4429187', NULL,                          '+44 7700 900654'),
    (${ADMIN_ID},   'Alex Morgan',          'admin',  'administrator', NULL,       NULL,                           '+44 7700 900999')
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        role = EXCLUDED.role,
        job_role = EXCLUDED.job_role,
        registration_number = EXCLUDED.registration_number,
        specialization = EXCLUDED.specialization,
        phone = EXCLUDED.phone
`;
const fixtureHash = await hashPassword('password');
const fixtureUsers = await db<{ id: string; name: string }[]>`
  SELECT id, name FROM staff.users WHERE id IN (${DOCTOR_ID}, ${DOCTOR_ID2}, ${DOCTOR_ID3}, ${NURSE_ID}, ${ADMIN_ID})
`;
for (const user of fixtureUsers) await db`
  INSERT INTO staff.user_credentials (user_id, email, password_hash)
  VALUES (${user.id}, ${demoEmail(user.name)}, ${fixtureHash})
  ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash
`;
logger.info('Seeded users and demo credentials');

// 3 — Build 100 patient records
const patients = Array.from({ length: 100 }, (_, i) => {
  const sex = i < 55 ? 'male' : 'female';
  const firstName = sex === 'male' ? pick(MALE_FIRST) : pick(FEMALE_FIRST);
  const lastName = pick(LAST);
  const ageYears = rand(22, 88);
  const dobYear = new Date().getFullYear() - ageYears;
  const dob = `${dobYear}-${String(rand(1, 12)).padStart(2, '0')}-${String(rand(1, 28)).padStart(2, '0')}`;
  const hasAllergy = Math.random() < 0.3;
  const allergies = hasAllergy
    ? pickN(ALLERGENS, rand(1, 2)).map((a) => ({
        ...a,
        reaction: 'rash and hives',
      }))
    : [];

  return {
    name: `${firstName} ${lastName}`,
    dob,
    sex,
    blood_group: Math.random() < 0.85 ? pick(BLOOD_GROUPS) : null,
    phone: `+1 ${rand(200, 999)}-${rand(200, 999)}-${rand(1000, 9999)}`,
    address: `${rand(1, 999)} ${pick(['Maple', 'Oak', 'Elm', 'Cedar', 'Park', 'Lake', 'River', 'Hill'])} ${pick(['Street', 'Avenue', 'Road', 'Drive', 'Close', 'Lane'])}, ${pick(['London', 'Manchester', 'Birmingham', 'Leeds', 'Bristol', 'Edinburgh', 'Cardiff', 'Oxford', 'Cambridge', 'York'])}`,
    abha_id: null,
    allergies: db.json(allergies),
    created_by: DOCTOR_ID,
  };
});

const insertedPatients = await db<{ id: string; uhid: string }[]>`
  INSERT INTO clinical.patients ${db(patients, 'name', 'dob', 'sex', 'blood_group', 'phone', 'address', 'abha_id', 'allergies', 'created_by')}
  RETURNING id, uhid
`;
await db`
  INSERT INTO clinical.patient_identifiers (patient_id, type, value, issuer)
  SELECT id, 'uhid', uhid, 'KliniK' FROM clinical.patients
`;
await db`
  INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
  SELECT id, 'phone', 'Primary', phone, true FROM clinical.patients WHERE phone IS NOT NULL
`;
await db`
  INSERT INTO clinical.patient_contacts (patient_id, type, label, value, is_primary)
  SELECT id, 'address', 'Home', address, true FROM clinical.patients WHERE address IS NOT NULL
`;
const patientIds = insertedPatients.map((r) => r.id);
logger.info(`Seeded ${patientIds.length} patients`);

// 4 — 60 active admissions (patients 0-59) + 20 discharged (patients 60-79)
// Doctor distribution: 0-19 → DOCTOR_ID (~20), 20-39 → DOCTOR_ID2 (~20), 40-49 → DOCTOR_ID3 (~10), 50-59 → open
const admissions: {
  patient_id: string;
  status: string;
  ward: string;
  bed: string;
  admitted_at: Date;
  discharged_at: Date | null;
  assigned_to: string | null;
  assigned_doctor_id: string | null;
  created_by: string;
}[] = [];

function assignedDoctor(i: number): string | null {
  if (i < 20) return DOCTOR_ID;
  if (i < 40) return DOCTOR_ID2;
  if (i < 50) return DOCTOR_ID3;
  return null; // open
}

// 60 active
const activeBedCount = new Map<string, number>();
for (let i = 0; i < 60; i++) {
  const ward = pick(WARDS);
  const bedNumber = (activeBedCount.get(ward) ?? 0) + 1;
  activeBedCount.set(ward, bedNumber);
  const bedNum = String(bedNumber).padStart(2, '0');
  admissions.push({
    patient_id: patientIds[i],
    status: 'active',
    ward,
    bed: `${WARD_PREFIX[ward]}-${bedNum}`,
    admitted_at: hoursAgo(rand(2, 72)),
    discharged_at: null,
    assigned_to: i < 30 ? NURSE_ID : null,
    assigned_doctor_id: assignedDoctor(i),
    created_by: DOCTOR_ID,
  });
}

// 20 discharged
for (let i = 60; i < 80; i++) {
  const ward = pick(WARDS);
  const bedNum = String(rand(1, 20)).padStart(2, '0');
  const admittedAt = daysAgo(rand(7, 30));
  admissions.push({
    patient_id: patientIds[i],
    status: 'discharged',
    ward,
    bed: `${WARD_PREFIX[ward]}-${bedNum}`,
    admitted_at: admittedAt,
    discharged_at: new Date(admittedAt.getTime() + rand(2, 6) * 86400_000),
    assigned_to: NURSE_ID,
    assigned_doctor_id: assignedDoctor(i - 60),
    created_by: DOCTOR_ID,
  });
}

const insertedAdmissions = await db<
  { id: string; patient_id: string; ward: string; status: string }[]
>`
  INSERT INTO clinical.admissions ${db(admissions, 'patient_id', 'status', 'ward', 'bed', 'admitted_at', 'discharged_at', 'assigned_to', 'assigned_doctor_id', 'created_by')}
  RETURNING id, patient_id, ward, status
`;
logger.info(`Seeded ${insertedAdmissions.length} admissions`);

const [defaultUnit] = await db<{ id: string }[]>`
  SELECT u.id
  FROM organization.units u
  JOIN organization.departments d ON d.id = u.department_id
  JOIN organization.facilities f ON f.id = d.facility_id
  WHERE f.code = 'DEFAULT' AND d.code = 'INPATIENT' AND u.code = 'INPATIENT'
`;
for (const wardName of WARDS) {
  const [ward] = await db<{ id: string }[]>`
    INSERT INTO organization.wards (unit_id, name)
    VALUES (${defaultUnit.id}, ${wardName})
    ON CONFLICT (unit_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const [room] = await db<{ id: string }[]>`
    INSERT INTO organization.rooms (ward_id, name)
    VALUES (${ward.id}, 'Default')
    ON CONFLICT (ward_id, name) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;
  const labels = [...new Set(admissions.filter((admission) => admission.ward === wardName).map((admission) => admission.bed))];
  for (const label of labels) {
    await db`
      INSERT INTO organization.beds (room_id, label)
      VALUES (${room.id}, ${label})
      ON CONFLICT (room_id, label) DO NOTHING
    `;
  }
}
await db`
  UPDATE clinical.admissions a
  SET bed_id = b.id, unit_id = w.unit_id
  FROM organization.beds b
  JOIN organization.rooms r ON r.id = b.room_id
  JOIN organization.wards w ON w.id = r.ward_id
  WHERE a.ward = w.name AND a.bed = b.label
`;

await db`
  INSERT INTO clinical.bed_assignments (admission_id, bed_id, starts_at, ends_at, assigned_by, end_reason)
  SELECT id, bed_id, admitted_at,
         CASE WHEN status = 'discharged' THEN discharged_at END,
         created_by,
         CASE WHEN status = 'discharged' THEN 'discharge' END
  FROM clinical.admissions WHERE bed_id IS NOT NULL
`;
await db`
  INSERT INTO clinical.observation_schedules
    (admission_id, frequency_minutes, next_due_at, source, policy_version, updated_by)
  SELECT id, 720, now(), 'news2_policy', 'NEWS2-2017-scale-1', created_by
  FROM clinical.admissions WHERE status = 'active'
`;

await db`
  INSERT INTO staff.unit_memberships (user_id, unit_id, is_primary)
  SELECT assigned_doctor_id, unit_id, false
  FROM clinical.admissions
  WHERE assigned_doctor_id IS NOT NULL AND unit_id IS NOT NULL
  UNION
  SELECT assigned_to, unit_id, false
  FROM clinical.admissions
  WHERE assigned_to IS NOT NULL AND unit_id IS NOT NULL
  UNION
  SELECT ${ADMIN_ID}::uuid, id, false FROM organization.units
  ON CONFLICT (user_id, unit_id) DO NOTHING
`;
const shiftedUsers = [DOCTOR_ID, DOCTOR_ID2, DOCTOR_ID3, NURSE_ID];
for (const userId of shiftedUsers) {
  const [shift] = await db<{ id: string }[]>`
    INSERT INTO staff.shifts (user_id, starts_at, ends_at, status, created_by)
    VALUES (${userId}, now() - interval '4 hours', now() + interval '8 hours', 'active', ${ADMIN_ID})
    RETURNING id
  `;
  await db`
    INSERT INTO staff.shift_units (shift_id, unit_id)
    SELECT ${shift.id}, unit_id FROM staff.unit_memberships WHERE user_id = ${userId}
    ON CONFLICT DO NOTHING
  `;
}
await db`
  INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
  SELECT a.id, a.assigned_doctor_id,
         CASE WHEN u.job_role = 'consultant' THEN 'treating_consultant' ELSE 'duty_doctor' END,
         ${ADMIN_ID}
  FROM clinical.admissions a
  JOIN staff.users u ON u.id = a.assigned_doctor_id
  WHERE a.assigned_doctor_id IS NOT NULL
  ON CONFLICT DO NOTHING
`;
await db`
  INSERT INTO clinical.staff_assignments (admission_id, user_id, assignment_type, assigned_by)
  SELECT id, assigned_to, 'primary_nurse', ${ADMIN_ID}
  FROM clinical.admissions
  WHERE assigned_to IS NOT NULL
  ON CONFLICT DO NOTHING
`;

// 5 — Diagnoses for all admissions
const diagnoses: {
  patient_id: string;
  admission_id: string;
  description: string;
  status: string;
  created_by: string;
}[] = [];
for (const adm of insertedAdmissions) {
  const pool = DIAGNOSES[adm.ward] ?? DIAGNOSES['General Medicine'];
  const count = rand(1, 3);
  const picked = pickN(pool, count);
  for (const description of picked) {
    diagnoses.push({
      patient_id: adm.patient_id,
      admission_id: adm.id,
      description,
      status: adm.status === 'discharged' ? 'resolved' : 'active',
      created_by: DOCTOR_ID,
    });
  }
}
await db`
  INSERT INTO clinical.diagnoses ${db(diagnoses, 'patient_id', 'admission_id', 'description', 'status', 'created_by')}
`;
logger.info(`Seeded ${diagnoses.length} diagnoses`);

// 6 — Notes for active admissions (not all — 80% chance per admission)
const activeAdmissions = insertedAdmissions.filter(
  (a) => a.status === 'active'
);
const notes: {
  admission_id: string;
  kind: string;
  draft_body: string;
  created_by: string;
}[] = [];
for (const adm of activeAdmissions) {
  if (Math.random() < 0.8) {
    notes.push({
      admission_id: adm.id,
      kind: pick(['ward_round', 'admission', 'progress', 'handover']),
      draft_body: pick(NOTE_BODIES),
      created_by: DOCTOR_ID,
    });
  }
  // 30% chance of a second note
  if (Math.random() < 0.3) {
    notes.push({
      admission_id: adm.id,
      kind: 'progress',
      draft_body: pick(NOTE_BODIES),
      created_by: DOCTOR_ID,
    });
  }
}
await db`
  INSERT INTO clinical.notes ${db(notes, 'admission_id', 'kind', 'draft_body', 'created_by')}
`;
logger.info(`Seeded ${notes.length} notes`);

// 7 — Orders for active admissions (1-3 per admission, some confirmed with tasks)
let orderCount = 0;
let taskCount = 0;
for (const adm of activeAdmissions) {
  const numOrders = rand(1, 3);
  for (let o = 0; o < numOrders; o++) {
    const kind = pick([
      'medication',
      'medication',
      'investigation',
      'nursing',
    ] as const);
    let payload: Record<string, string | number | boolean | null>;
    if (kind === 'medication') {
      payload = pick(MED_ORDERS);
    } else if (kind === 'investigation') {
      payload = pick(INVEST_ORDERS);
    } else {
      payload = pick(NURSING_ORDERS);
    }

    const confirm = Math.random() < 0.65;
    const confirmedAt = confirm
      ? new Date(Date.now() - rand(10, 120) * 60_000)
      : null;

    const [order] = await db<{ id: string }[]>`
      INSERT INTO clinical.orders (admission_id, kind, payload, status, created_by, confirmed_by, confirmed_at)
      VALUES (
        ${adm.id}, ${kind}, ${db.json(payload)},
        ${confirm ? 'confirmed' : 'draft'},
        ${DOCTOR_ID},
        ${confirm ? DOCTOR_ID : null},
        ${confirmedAt}
      )
      RETURNING id
    `;
    orderCount++;

    if (confirm) {
      const dueAt = new Date(Date.now() + rand(30, 360) * 60_000);
      const done = Math.random() < 0.4;
      const completedAt = done
        ? new Date(Date.now() - rand(5, 60) * 60_000)
        : null;
      await db`
        INSERT INTO clinical.tasks (order_id, admission_id, due_at, status, completed_by, completed_at)
        VALUES (
          ${order.id}, ${adm.id}, ${dueAt},
          ${done ? 'done' : 'pending'},
          ${done ? NURSE_ID : null},
          ${completedAt}
        )
      `;
      taskCount++;
    }
  }
}
logger.info(`Seeded ${orderCount} orders, ${taskCount} tasks`);

// 8 — Vitals for active admissions (2-4 readings each, spaced hours apart)
const VITALS_BY_WARD: Record<string, { bp: [number, number]; hr: [number, number]; spo2: [number, number]; temp: [number, number]; glucose: [number, number] }> = {
  Cardiology:        { bp: [130, 160], hr: [70, 110], spo2: [92, 98], temp: [36.5, 37.8], glucose: [90, 160] },
  Neurology:         { bp: [120, 155], hr: [60, 95],  spo2: [94, 99], temp: [36.5, 38.2], glucose: [85, 130] },
  Orthopedics:       { bp: [115, 145], hr: [65, 90],  spo2: [95, 99], temp: [36.8, 38.5], glucose: [80, 120] },
  Respiratory:       { bp: [120, 150], hr: [75, 105], spo2: [88, 97], temp: [36.5, 39.0], glucose: [90, 140] },
  'General Medicine':{ bp: [125, 155], hr: [68, 95],  spo2: [93, 99], temp: [36.6, 38.8], glucose: [100, 200] },
  ICU:               { bp: [80,  160], hr: [50, 130], spo2: [85, 98], temp: [36.0, 40.0], glucose: [60, 250] },
};

function randFloat(min: number, max: number, dp = 1) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(dp));
}

let vitalsCount = 0;
for (const adm of activeAdmissions) {
  const range = VITALS_BY_WARD[adm.ward] ?? VITALS_BY_WARD['General Medicine'];
  const numReadings = rand(2, 4);
  for (let r = 0; r < numReadings; r++) {
    const hoursBack = (numReadings - r) * rand(4, 8);
    await db`
      INSERT INTO clinical.vitals
        (admission_id, recorded_by, recorded_at, bp_systolic, bp_diastolic, heart_rate, spo2, resp_rate, temperature, glucose)
      VALUES (
        ${adm.id}, ${NURSE_ID},
        ${hoursAgo(hoursBack)},
        ${rand(range.bp[0], range.bp[1])},
        ${rand(60, 90)},
        ${rand(range.hr[0], range.hr[1])},
        ${randFloat(range.spo2[0], range.spo2[1])},
        ${rand(14, 22)},
        ${randFloat(range.temp[0], range.temp[1])},
        ${rand(range.glucose[0], range.glucose[1])}
      )
    `;
    vitalsCount++;
  }
}
logger.info(`Seeded ${vitalsCount} vitals readings`);

// 9 — Sample handoffs: ~half of nurse-assigned active admissions
const assignedAdmissions = insertedAdmissions.filter(
  (a) => a.status === 'active'
).slice(0, 30); // first 30 were assigned to NURSE_ID in step 4

const HANDOFF_REASONS = [
  'STAT IV Furosemide ordered — requires urgent bedside check',
  '12-lead ECG requested, patient complaining of chest tightness',
  'Post-procedure monitoring — BP check every 30 min',
  'Patient confused and agitated, needs reassessment',
  'New nursing order: strict fluid balance charting commenced',
  'Wound dressing due, patient requesting pain relief first',
];

let handoffCount = 0;
for (let i = 0; i < assignedAdmissions.length; i++) {
  if (Math.random() > 0.5) continue;
  const adm = assignedAdmissions[i];
  const status = Math.random() < 0.5 ? 'pending' : (Math.random() < 0.6 ? 'acknowledged' : 'done');
  const requestedAt = hoursAgo(rand(1, 6));
  const acknowledgedAt = status !== 'pending' ? new Date(requestedAt.getTime() + rand(5, 30) * 60_000) : null;
  const doneAt = status === 'done' ? new Date((acknowledgedAt ?? requestedAt).getTime() + rand(15, 60) * 60_000) : null;

  await db`
    INSERT INTO clinical.handoffs
      (admission_id, requested_by, assigned_to, reason, status, requested_at, acknowledged_by, acknowledged_at, done_at)
    VALUES (
      ${adm.id}, ${DOCTOR_ID}, ${NURSE_ID},
      ${pick(HANDOFF_REASONS)},
      ${status},
      ${requestedAt},
      ${status !== 'pending' ? NURSE_ID : null},
      ${acknowledgedAt},
      ${doneAt}
    )
  `;
  handoffCount++;
}
logger.info(`Seeded ${handoffCount} handoffs`);

await db.end();
logger.info(
  `Seeding done.\n  Dr. Harrington : ${DOCTOR_ID}  +44 7700 900321\n  Dr. Patel      : ${DOCTOR_ID2} +44 7700 900322\n  Dr. Chen       : ${DOCTOR_ID3} +44 7700 900323\n  Nurse Mitchell : ${NURSE_ID}  +44 7700 900654`
);
