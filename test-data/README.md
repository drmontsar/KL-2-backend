# KliniK test data

These JSON files describe a fictional hospital dataset for local testing. The displayed names, medications, diagnoses, and documents are realistic-looking but are not clinical or legal reference data.

## Files

- `manifest.json` sets the dataset ID, baseline timestamp, and load order.
- `organization.json` defines the hospital, unit, ward, room, and beds.
- `staff.json` defines staff, unit memberships, and shifts.
- `catalogs.json` defines medication, diagnosis, investigation, and form catalogue entries.
- `patients.json` defines people, identifiers, contacts, next of kin, and coverage.
- `clinical.json` defines admissions, assignments, observations, notes, orders, MAR, and infusion records.
- `workflows.json` defines nursing, referrals, claims, discharge, OPD, forms, and handover scenarios.

Each data file contains an ordered array of `{ "table": "schema.table", "rows": [...] }` groups. Each row uses database column names. Records referenced by another group must appear first in the manifest/file order. The script permits only the known tables declared in `src/db/seed-test-data.ts`.

## Seed a local database

```bash
bun install
cp .env.example .env  # edit DATABASE_URL if the default port is occupied
docker compose up -d
bun run seed
```

`bun run seed` applies the migrations before loading the files. It is limited to a local, non-production PostgreSQL database named `klinik` using the `klinik` database user. It inserts missing records in one transaction, tracks their IDs, rejects collisions with unrelated records, and never overwrites an existing row.

For an additional inpatient **Care Area** ward with 100 free beds (`CA-001`–`CA-100`) and three fictional consultants, run `bun run seed:care-area` after `bun run seed`. It is idempotent and local-only; re-run it after `reset:demo` if you want these optional additions back. Demo consultant phones: Dr. Mira Kapoor `+1 202 555 0161`, Dr. Farhan Ali `+1 202 555 0162`, Dr. Leena Nair `+1 202 555 0163`.

## Replace mixed or outdated data

Stop the API, then run:

```bash
bun run reset:demo
bun run server
```

This deletes every row in the application schemas (`organization`, `staff`, `clinical`, `finance`, `opd`, `forms`, and `test_data`), including users, sessions, audit records, and data from previous generators. It preserves schema definitions and migration history. Tables in other schemas are not reset; external foreign-key dependencies stop the reset rather than being deleted through CASCADE. Use this only for disposable local test data.

Migrations run first. Deletion and fixture insertion then share one transaction. A failed insert rolls back the whole data reset.

Reset moves timestamp columns relative to `snapshot_at` so shifts, observations, tasks, and planned workflows are current. Birth dates and coverage dates stay unchanged. Migration 052 stores the selected clock in `test_data.datasets`; a later non-destructive seed uses the same clock and preserves existing rows.

Bruce Wayne (`1112223330`) is a required enabled duty-doctor fixture. Reset restores his name, role, active shift, unit membership, and coverage assignments. He can access both inpatient examples without replacing their primary doctor. Any non-empty OTP works in development/test.

The loader checks NEWS2 and nursing scores against the application rules. PostgreSQL validates columns, foreign keys, uniqueness, and checks during insertion. I-PASS revisions and nurse handover snapshots are derived from the loaded clinical state rather than hardcoded placeholders. The dataset includes ward observations, orders, MAR, infusion, nursing, referral, claim, discharge, OPD, admission-intake, consent-form, and handover scenarios.

Fixture IDs stay stable. `bun run seed` on a fresh database uses the fixed baseline for reproducible tests. It does not refresh existing records or remove legacy data. Use `reset:demo` to replace them. If your own duty-doctor login needs access to existing admissions, run `bun run assign:test-user -- <phone>`; this does not generate data or replace the primary doctor.

Legacy generators are internal integration fixtures under `test/fixtures/legacy/`. The integration runner uses them only with disposable databases. The canonical loader preserves previous legacy records; it does not delete or rewrite their historical content.
