// Idempotent local demo addition. Run after migrations: bun run seed:care-area
import { config } from '../config';
import { db } from './index';

const url = new URL(config.databaseUrl);
if (
  !['development', 'test'].includes(config.nodeEnv) ||
  !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname) ||
  url.pathname !== '/klinik' ||
  url.username !== 'klinik'
) throw new Error('Refusing to add demo data outside the local klinik database');

const consultants = [
  { name: 'Dr. Mira Kapoor', phone: '+1 202 555 0161', registration: 'KMC-30001', specialty: 'General Medicine' },
  { name: 'Dr. Farhan Ali', phone: '+1 202 555 0162', registration: 'KMC-30002', specialty: 'Cardiology' },
  { name: 'Dr. Leena Nair', phone: '+1 202 555 0163', registration: 'KMC-30003', specialty: 'Internal Medicine' },
];

try {
  await db.begin(async (tx) => {
    const [target] = await tx<{ database: string; user_name: string }[]>`SELECT current_database() AS database, current_user AS user_name`;
    if (target.database !== 'klinik' || target.user_name !== 'klinik')
      throw new Error('Refusing to add demo data to an unexpected database');
    await tx`SELECT pg_advisory_xact_lock(hashtextextended('klinik:care-area', 0))`;
    const [facility] = await tx<{ id: string }[]>`SELECT id FROM organization.facilities WHERE code = 'KLINIK-CITY-01'`;
    if (!facility) throw new Error('Seed the demo hospital before adding Care Area beds');
    const [department] = await tx<{ id: string }[]>`
      INSERT INTO organization.departments (facility_id, code, name)
      VALUES (${facility.id}, 'INPATIENT', 'Inpatient Services')
      ON CONFLICT (facility_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id
    `;
    const [unit] = await tx<{ id: string }[]>`
      INSERT INTO organization.units (department_id, code, name, kind)
      VALUES (${department.id}, 'CA', 'Care Area', 'inpatient')
      ON CONFLICT (department_id, code) DO UPDATE SET code = EXCLUDED.code RETURNING id
    `;
    const [ward] = await tx<{ id: string }[]>`
      INSERT INTO organization.wards (unit_id, name) VALUES (${unit.id}, 'Care Area')
      ON CONFLICT (unit_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `;
    const [room] = await tx<{ id: string }[]>`
      INSERT INTO organization.rooms (ward_id, name) VALUES (${ward.id}, 'Care Area Beds')
      ON CONFLICT (ward_id, name) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `;
    await tx`
      INSERT INTO organization.beds (room_id, label)
      SELECT ${room.id}, 'CA-' || lpad(n::text, 3, '0') FROM generate_series(1, 100) AS n
      ON CONFLICT (room_id, label) DO NOTHING
    `;
    const [beds] = await tx<{ total: number; unavailable: number }[]>`
      SELECT count(*)::int AS total,
        count(*) FILTER (WHERE b.operational_state <> 'available'
          OR EXISTS (SELECT 1 FROM clinical.admissions a WHERE a.bed_id = b.id AND a.status = 'active')
          OR EXISTS (SELECT 1 FROM organization.bed_reservations r WHERE r.bed_id = b.id AND r.released_at IS NULL))::int AS unavailable
      FROM organization.beds b WHERE b.room_id = ${room.id} AND b.label ~ '^CA-(00[1-9]|0[1-9][0-9]|100)$'
    `;
    if (beds.total !== 100 || beds.unavailable !== 0)
      throw new Error('Expected CA-001 to CA-100 to be free; no data was changed');

    for (const doctor of consultants) {
      await tx`
        INSERT INTO staff.users (name, phone, role, job_role, registration_number, specialization)
        VALUES (${doctor.name}, ${doctor.phone}, 'doctor', 'consultant', ${doctor.registration}, ${doctor.specialty})
        ON CONFLICT (phone) DO NOTHING
      `;
      const [user] = await tx<{ id: string; name: string; job_role: string; disabled_at: Date | null }[]>`
        SELECT id, name, job_role, disabled_at FROM staff.users WHERE phone = ${doctor.phone}
      `;
      if (!user || user.name !== doctor.name || user.job_role !== 'consultant' || user.disabled_at)
        throw new Error(`Consultant phone ${doctor.phone} is already in use`);
      await tx`INSERT INTO staff.unit_memberships (user_id, unit_id) VALUES (${user.id}, ${unit.id}) ON CONFLICT DO NOTHING`;
    }
  });
  console.log('Care Area: 100 free beds (CA-001–CA-100); 3 demo consultants ready.');
} finally {
  await db.end();
}
