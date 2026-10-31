# Legacy integration fixtures

These files remain because integration tests depend on their scenarios. They are not local demo setup commands. Use `bun run seed` for demo data.

- `seed.ts` resets clinical data and creates the older staff and patient scenarios. It requires `NODE_ENV=test` and `DISPOSABLE_DATABASE=1` before it opens a database connection.
- `seed-demo.sql` adds fixed workflow scenarios and checks for reserved-ID collisions.
- `fill-demo-gaps.sql` adds synthetic observations and missing legacy patient details.

`scripts/test-integration.sh` supplies disposable PostgreSQL databases, invokes these fixtures, and checks their idempotence and collision behavior. Run them only through `bun run test:integration`. Do not execute the SQL manually against a shared database.
