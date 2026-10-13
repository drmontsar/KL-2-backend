# Migrations

## How to run

```bash
bun run migrate
```

Runs all unapplied migrations in order. Applied migrations are tracked in the `_migrations` table — already-applied files are skipped automatically.

## Naming convention

```
migrations/001_<description>.sql
```

Increment the number for each new migration. Keep descriptions short and lowercase with underscores.

Examples:
```
001_initial_schema.sql
002_add_appointments_table.sql
003_add_doctor_id_to_appointments.sql
```

## Structure

Every migration file must have both an **up** and a **down** section.

```sql
-- up
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL
);

-- down
DROP TABLE users;
```

The runner reads everything between `-- up` and `-- down` and executes it in a transaction. The `-- down` section is documentation only — the runner does not execute it automatically.

## Rules

- Always write the down migration. If it can't be reversed, note why.
- Never edit a migration that has already been applied — make a new file instead.
- New changes always go in a new file.
- Drop order in `-- down` must be the reverse of create order (respect FK constraints).
