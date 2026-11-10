# KliniK backend

GitHub Actions runs CI; deployment is not configured yet.

API and database for the KliniK doctor frontend in `../KL-2-doc`.

The standalone service uses `src/main.ts` for Bun startup and `src/app.ts` for application construction. See [the architecture guide](docs/architecture.md) for module boundaries and reference patterns.

```bash
bun install
cp .env.example .env
docker compose up -d
bun run seed  # applies migrations and inserts the portable fixture data
bun run dev
```

The API runs at `http://localhost:3001`; OpenAPI docs are at `/docs`.
PostgreSQL uses host port `5433` by default. If that port is occupied, set `POSTGRES_PORT` and the matching port in `DATABASE_URL` in `.env` before starting Docker (for example, use `5434` for both).
Logs are formatted with `pino-pretty` locally and emitted as JSON when `NODE_ENV=production`; authentication and patient-sensitive fields are redacted.
Set `CORS_ORIGINS` to a comma-separated list of allowed frontend origins. Development defaults to `http://localhost:3000,http://localhost:5173`; production allows none until configured.
## Clean test database

If the database contains mixed old and new demo data, stop the API and run:

```bash
bun run reset:demo
bun run dev
```

**Warning:** `reset:demo` deletes all local application data, including users, sessions, patients, clinical records, catalogues, and audit records. It keeps the schema and migration history, then loads only the current canonical fixtures. Existing logins expire; sign in again after restarting the API.

The command is restricted to a local `klinik` database, the `klinik` database user, and development/test mode. Migrations run first. The data reset and reload share one transaction; a failed fixture insert restores the previous application data. Operational timestamps are moved to the reset time, preserving their relative intervals. Birth dates and insurance dates do not move.

**Test login: Bruce Wayne — `bruce+wayne@klinik.com` / `password`**. He is an enabled duty doctor. These shared demo credentials are for local/test fixtures only.

## Portable test data

The canonical dataset is in `test-data/`: `manifest.json` defines the file order and fixed snapshot time, while the other JSON files contain organization, staff, catalogue, patient, clinical, and workflow records. `bun run seed` applies migrations and inserts missing fixture records without deleting existing data. It works on a newly created local `klinik` database without running the old seed.

The loader only inserts missing fixture records and never overwrites existing records. It records ownership in `test_data.seed_records`, rejects collisions with untracked records, and is safe to rerun. If you edit a data file, the new values are used on a fresh database; existing fixture records are deliberately not updated. Fresh additive loads use the fixed `snapshot_at` baseline for reproducibility. Reset selects the current clock; later additive loads preserve that selected clock.

Demo accounts include Bruce Wayne (`bruce+wayne@klinik.com`), duty doctor (`arjun+mehta@klinik.com`), consultant (`priya+shah@klinik.com`), nurse (`anita+rao@klinik.com`), and administrator (`kiran+patel@klinik.com`). The address is their first and second name (ignoring `Dr.`), joined with a literal `+` and followed by `@klinik.com`. All use the local/test password above. Production has no default password; provision the first administrator with `ADMIN_EMAIL` and `ADMIN_PASSWORD` using `bun run auth:bootstrap-admin` after migrations, then let that administrator create staff or assign credentials. The migration expires old OTP-issued sessions.

Existing historical records from previous seeds are preserved. The old generators now live under `test/fixtures/legacy/` and run only as integration fixtures, not as setup commands. The fixture data is fictional and is not a validated clinical or legal reference.

Run checks in order:

```bash
bun run verify  # TypeScript, unit tests, and database integration tests. Requires Docker.
```
