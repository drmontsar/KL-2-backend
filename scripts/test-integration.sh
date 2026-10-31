#!/usr/bin/env bash
set -euo pipefail

container="klinik-security-test-$$"
server_pid=""
portable_container=""
server_port="3311"

cleanup() {
  if [[ -n "$server_pid" ]]; then
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" >/dev/null 2>&1 || true
  fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n "$portable_container" ]]; then docker rm -f "$portable_container" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

docker run --rm -d --name "$container" \
  -e POSTGRES_DB=klinik \
  -e POSTGRES_USER=klinik \
  -e POSTGRES_PASSWORD=klinik \
  -p 127.0.0.1::5432 postgres:17-alpine >/dev/null

ready=0
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U klinik -d klinik >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  docker logs "$container"
  exit 1
fi
sleep 2
docker exec "$container" pg_isready -U klinik -d klinik >/dev/null

db_port="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')"
export DATABASE_URL="postgres://klinik:klinik@127.0.0.1:${db_port}/klinik"
export DISPOSABLE_DATABASE=1

bun run migrate >/dev/null
# Verify the portable fixture loader against a migrated, otherwise empty test database.
docker exec "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -c "INSERT INTO staff.users (id, name, role, job_role, phone) VALUES ('11000000-0000-4000-8000-000000000001', 'Unrelated staff', 'doctor', 'duty_doctor', '+1 202 555 0199')" >/dev/null
if NODE_ENV=test bun run seed >/dev/null 2>&1; then
  echo 'Test-data seed did not reject an untracked fixed-ID collision' >&2
  exit 1
fi
collision_rollback="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT (SELECT count(*) FROM organization.facilities WHERE code='KLINIK-CITY-01') = 0 AND (SELECT count(*) FROM test_data.seed_records) = 0 AND (SELECT count(*) FROM staff.users WHERE id='11000000-0000-4000-8000-000000000001' AND name='Unrelated staff') = 1")"
if [[ "$collision_rollback" != 't' ]]; then
  echo 'Test-data seed failed collision rollback check' >&2
  exit 1
fi
docker exec "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -c "DELETE FROM staff.users WHERE id = '11000000-0000-4000-8000-000000000001'" >/dev/null
NODE_ENV=test bun run seed >/dev/null
docker exec "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -c "UPDATE clinical.patients SET name = 'Ananya Sharma Updated' WHERE id = '13000000-0000-4000-8000-000000000001'" >/dev/null
NODE_ENV=test bun run seed >/dev/null
bun run test/test-data-integration.ts
NODE_ENV=test bun run test/fixtures/legacy/seed.ts >/dev/null
NODE_ENV=test bun run test/integration/migrations.ts
NODE_ENV=test PORT="$server_port" bun run server >/tmp/klinik-security-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:${server_port}/openapi.json" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:${server_port}/openapi.json" >/dev/null

BASE_URL="http://127.0.0.1:${server_port}" bun run test/security-integration.ts
BASE_URL="http://127.0.0.1:${server_port}" bun run test/dashboard-integration.ts
NODE_ENV=test bun run test/integration/regressions.ts
NODE_ENV=production bun run test/integration/production_auth.ts

before_patients="$(docker exec "$container" psql -U klinik -d klinik -Atc 'SELECT count(*) FROM clinical.patients')"
for _ in 1 2; do
  docker exec -i "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -f - < test/fixtures/legacy/seed-demo.sql >/dev/null
done
after_patients="$(docker exec "$container" psql -U klinik -d klinik -Atc 'SELECT count(*) FROM clinical.patients')"
if [[ "$after_patients" -ne "$((before_patients + 4))" ]]; then
  echo 'Demo seed failed its non-destructive/idempotence check' >&2
  exit 1
fi
fixtures="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT (SELECT count(*) FROM clinical.patients WHERE name LIKE '[DEMO] %') = 4 AND (SELECT count(*) FROM opd.visits WHERE id IN ('da000000-0000-4000-8000-000000000001','da000000-0000-4000-8000-000000000002')) = 2 AND EXISTS (SELECT 1 FROM finance.claims WHERE id = 'd8000000-0000-4000-8000-000000000001') AND EXISTS (SELECT 1 FROM clinical.medication_schedules WHERE id = 'd5000000-0000-4000-8000-000000000001') AND EXISTS (SELECT 1 FROM forms.instances WHERE id = 'db000000-0000-4000-8000-000000000001') AND EXISTS (SELECT 1 FROM clinical.ipass_sessions WHERE id = 'd0200000-0000-4000-8000-000000000001' AND status = 'sent') AND EXISTS (SELECT 1 FROM clinical.nurse_handover_sessions WHERE id = 'd0300000-0000-4000-8000-000000000001' AND status = 'sent')")"
if [[ "$fixtures" != 't' ]]; then
  echo 'Demo seed is missing expected scenarios' >&2
  exit 1
fi
before_vitals="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT md5(COALESCE(string_agg(row_to_json(v)::text, ',' ORDER BY v.id), '')) FROM clinical.vitals v WHERE recorded_by <> 'd0400000-0000-4000-8000-000000000001'")"
docker exec -i "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -f - < test/fixtures/legacy/fill-demo-gaps.sql >/dev/null
first_fixture_counts="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT (SELECT count(*) FROM clinical.vitals WHERE recorded_by = 'd0400000-0000-4000-8000-000000000001') || ':' || (SELECT count(*) FROM clinical.next_of_kin) || ':' || (SELECT count(*) FROM clinical.notes WHERE created_by = 'd0400000-0000-4000-8000-000000000001')")"
docker exec -i "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -f - < test/fixtures/legacy/fill-demo-gaps.sql >/dev/null
second_fixture_counts="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT (SELECT count(*) FROM clinical.vitals WHERE recorded_by = 'd0400000-0000-4000-8000-000000000001') || ':' || (SELECT count(*) FROM clinical.next_of_kin) || ':' || (SELECT count(*) FROM clinical.notes WHERE created_by = 'd0400000-0000-4000-8000-000000000001')")"
if [[ "$first_fixture_counts" != "$second_fixture_counts" ]]; then
  echo 'Synthetic gap fill is not idempotent' >&2
  exit 1
fi
after_vitals="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT md5(COALESCE(string_agg(row_to_json(v)::text, ',' ORDER BY v.id), '')) FROM clinical.vitals v WHERE recorded_by <> 'd0400000-0000-4000-8000-000000000001'")"
if [[ "$before_vitals" != "$after_vitals" ]]; then
  echo 'Synthetic gap fill changed existing observations' >&2
  exit 1
fi
BASE_URL="http://127.0.0.1:${server_port}" bun run test/fill-demo-integration.ts
NODE_ENV=test bun run seed >/dev/null
BASE_URL="http://127.0.0.1:${server_port}" bun run test/test-data-api.ts

primary_assignments_before="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT md5(COALESCE(string_agg(id::text || ':' || COALESCE(assigned_doctor_id::text, ''), ',' ORDER BY id), '')) FROM clinical.admissions WHERE status = 'active'")"
NODE_ENV=test bun run assign:test-user -- 1112223330 >/dev/null
coverage_count="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT count(*) FROM clinical.staff_assignments WHERE user_id = '11000000-0000-4000-8000-000000000007' AND assignment_type = 'coverage' AND ends_at IS NULL")"
NODE_ENV=test bun run assign:test-user -- 1112223330 >/dev/null
coverage_count_after="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT count(*) FROM clinical.staff_assignments WHERE user_id = '11000000-0000-4000-8000-000000000007' AND assignment_type = 'coverage' AND ends_at IS NULL")"
primary_assignments_after="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT md5(COALESCE(string_agg(id::text || ':' || COALESCE(assigned_doctor_id::text, ''), ',' ORDER BY id), '')) FROM clinical.admissions WHERE status = 'active'")"
missing_coverage="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT count(*) FROM clinical.admissions a WHERE a.status = 'active' AND a.assigned_doctor_id IS DISTINCT FROM '11000000-0000-4000-8000-000000000007'::uuid AND NOT EXISTS (SELECT 1 FROM clinical.staff_assignments s WHERE s.admission_id = a.id AND s.user_id = '11000000-0000-4000-8000-000000000007' AND s.ends_at IS NULL)")"
if [[ "$primary_assignments_before" != "$primary_assignments_after" || "$coverage_count" != "$coverage_count_after" || "$missing_coverage" != '0' ]]; then
  echo 'Test-user coverage changed primary assignments or was not idempotent' >&2
  exit 1
fi

# Simulate a second device: start a fresh database and seed it without a manual migration or readiness wait.
portable_container="klinik-portability-test-$$"
docker run --rm -d --name "$portable_container" \
  -e POSTGRES_DB=klinik -e POSTGRES_USER=klinik -e POSTGRES_PASSWORD=klinik \
  -p 127.0.0.1::5432 postgres:17-alpine >/dev/null
portable_port="$(docker port "$portable_container" 5432/tcp | awk -F: '{print $NF}')"
NODE_ENV=test DATABASE_URL="postgres://klinik:klinik@127.0.0.1:${portable_port}/klinik" bun run seed >/dev/null
snapshot_query="SELECT p.name || '|' || p.uhid || '|' || a.ward || '|' || a.bed || '|' || n.news2_score FROM clinical.patients p JOIN clinical.admissions a ON a.patient_id = p.id JOIN clinical.latest_news2 n ON n.admission_id = a.id WHERE p.id = '13000000-0000-4000-8000-000000000001'"
first_snapshot="$(docker exec "$container" psql -U klinik -d klinik -Atc "$snapshot_query")"
second_snapshot="$(docker exec "$portable_container" psql -U klinik -d klinik -Atc "$snapshot_query")"
if [[ -z "$first_snapshot" || "$first_snapshot" != "$second_snapshot" ]]; then
  echo 'Portable dataset differs across fresh database instances' >&2
  exit 1
fi
docker rm -f "$portable_container" >/dev/null
portable_container=""
echo 'Portable test-data second-device check passed'

docker exec "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -c "UPDATE clinical.patients SET name = 'Reserved ID collision' WHERE id = 'd1000000-0000-4000-8000-000000000001'" >/dev/null
if docker exec -i "$container" psql -U klinik -d klinik -v ON_ERROR_STOP=1 -f - < test/fixtures/legacy/seed-demo.sql >/dev/null 2>&1; then
  echo 'Demo seed did not reject a reserved-ID collision' >&2
  exit 1
fi
collision_name="$(docker exec "$container" psql -U klinik -d klinik -Atc "SELECT name FROM clinical.patients WHERE id = 'd1000000-0000-4000-8000-000000000001'")"
if [[ "$collision_name" != 'Reserved ID collision' ]]; then
  echo 'Demo seed overwrote an existing record on collision' >&2
  exit 1
fi
echo 'Demo seed non-destructive/idempotence/collision checks passed'
NODE_ENV=test bun run test/reset-demo-integration.ts
BASE_URL="http://127.0.0.1:${server_port}" bun run test/test-data-api.ts
NODE_ENV=test BASE_URL="http://127.0.0.1:${server_port}" bun run test/sse-integration.ts
