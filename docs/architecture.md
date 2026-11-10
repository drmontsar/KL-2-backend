# Backend architecture

## Service layout

KliniK is one standalone Bun service. Its layout follows the standalone services in Ferrygate and Permit, not the Surface workspace layout.

```text
src/
  main.ts             Bun entry point
  app.ts              Application factory, middleware, and route registration
  config.ts           Environment configuration
  errors.ts           Domain errors without HTTP or PostgreSQL details
  logger.ts           Structured logs and safe error diagnostics
  authorization.ts    Job-role permissions
  contracts/          Shared Zod schemas and input types
  routes/             HTTP validation, access checks, and response mapping
  services/           Notification subscriptions and readiness coordination
  clinical/           Pure clinical calculations and form rules
  db/
    index.ts          PostgreSQL connection
    errors.ts         Constraint-error translation
    queries/          Queries and transactional domain operations
    migrate.ts        Migration command
    seed-test-data.ts  Portable fixture loader
migrations/           Ordered schema changes
scripts/              Local setup and integration commands
test/
  *.test.ts           Unit tests and architecture checks
  integration/        Focused database regression suites
  fixtures/legacy/    Legacy generators used only by integration tests
test-data/            Portable, fictional fixture records
docs/                 API and architecture documentation
```

`makeApp()` constructs the application without a network listener. `main.ts` supplies its fetch handler and port to Bun. Tests can construct separate application instances.

## Reference patterns

The reference repositories do not use one identical structure. This backend adopts their applicable boundaries.

| Reference | Pattern used here |
| --- | --- |
| Ferrygate | Separate application construction from process startup and domain operations. |
| Permit | Keep permission decisions distinct from HTTP handlers and database details. |
| Surface | Separate shared contracts, authentication, and service responsibilities. Use a standalone layout because this repository contains one service. |
| Holster | Give subscription resources an explicit owner and cleanup path. |
| Dispatcher | Separate transport from durable records and notification delivery. |
| Kapital | Make database scope, access checks, and transaction boundaries explicit. |

## Responsibility boundaries

Routes validate parameters and bodies, check caller access, invoke named operations, and map results to HTTP responses. Routes do not contain SQL, PostgreSQL error codes, or connection management.

Contracts contain shared request schemas, response schemas, and inferred input types. They do not import HTTP handlers, services, or database modules. Native database row types remain in query modules.

Query modules own SQL, row locks, persistence rules, and transactions. A database-only workflow belongs in its domain query module. It does not need a service that only forwards arguments. Callers pass explicit inputs and actor IDs, not Hono contexts or transaction clients.

Services coordinate responsibilities outside a database operation. Notification subscriptions combine durable notification lookup with delivery and unsubscribe behavior. Readiness combines migration files with applied database migrations.

Clinical modules contain pure rules and calculations. They do not import database clients or HTTP code.

`authorization.ts` defines role permissions. Query helpers in `db/queries/access.ts` and `db/queries/admissions.ts` define record scope. Operations also enforce mutable state inside their transactions.

## Transactions and failure behavior

- A clinical mutation and its audit record commit together. Audit calls require an actor ID and the current transaction.
- Handoff, transfer, and legacy handover operations commit their durable notifications with their clinical records.
- PostgreSQL NOTIFY contains only a notification ID. The subscription service retrieves the full record for the authenticated user after commit.
- Subscription cleanup handles disconnects during setup and after setup. The HTTP route owns the stream and 25-second heartbeat. It disables Bun’s idle timeout for that streaming request through the native server API; ordinary HTTP requests keep their normal idle limit.
- Medication order creation and confirmation lock an active admission. Historical read access does not authorize new orders.
- Note confirmation locks the parent admission and note before it allocates a version number.
- Nursing completion identifies one expected occurrence and rejects retries of that occurrence.
- `db/errors.ts` maps known constraint failures to domain conflicts. HTTP middleware maps domain errors to responses.
- Error logs contain request IDs, safe error codes, and stack frames. They exclude raw messages, SQL values, and database details.

## Client and migration changes

Note draft updates require `expected_revision`. This applies to both `/notes/{id}/draft` and `/admissions/{id}/notes/{noteId}`. A stale revision returns HTTP 409.

Nursing task completion requires `expected_due_at`. Use the due time from the task response. The database comparison uses the millisecond precision that the JSON response exposes.

Staff creation requires a unique email and password; phone is optional contact data. Duplicate email or phone returns HTTP 409. Patient updates accept an empty string to clear a phone, address, or ABHA value and its corresponding primary identity record.

Migration `051_clinical_revisions.sql` advances admission revisions for clinical content changes. It also invalidates existing handover snapshots. After this migration, refresh a stale I-PASS item before acceptance. Clients must retrieve the latest admission revision after a clinical change before a revision-sensitive mutation.

The frontend note-update hook and nursing-task action include the new concurrency inputs. Other clients must adopt these inputs too.

## Authentication

Staff log in with email and password at `POST /auth/login`. Password hashes are stored separately from public staff rows using scrypt; legacy OTP-issued sessions are invalidated by migration 060. Administrators create users or provision credentials for existing staff, and the bootstrap CLI configures the first production administrator. No public registration, SMS provider, or OTP verification exists. Local fixtures use shared password `password` only on disposable local/test databases; do not seed them in production.

## Verification

Use `bun run seed` to insert missing demo records without overwriting data. Use `bun run reset:demo` to replace all local application records with the current fixtures. Reset includes users, sessions, and audit records, so stop the API first and sign in again afterwards. Migrations run before the atomic data reset and reload. PostgreSQL validates the fixtures during insertion; NEWS2 and nursing scores are also checked against the application rules. `assign:test-user` grants optional coverage; it does not generate data. Legacy generators are internal fixtures under `test/fixtures/legacy/`, not public seed commands.

Run `bun run verify` from the repository root. It runs the TypeScript check, unit tests, and the Docker-based integration suite.

Architecture tests enforce dependency direction and prohibit SQL and storage error codes in routes. Integration suites cover clinical state, record access, concurrent note confirmations, stale handovers, transaction rollback, notifications, patient identities, and the production authentication guard. The integration runner also checks migration down/up behavior and fixture idempotence.

Migration 052 stores each loaded dataset clock. Reset uses the current time and shifts operational timestamp columns relative to the manifest baseline. Subsequent additive seed runs preserve that clock. Birth dates and coverage dates are unchanged. Handover snapshots are derived from the loaded database state. Bruce Wayne (`1112223330`) is a required duty-doctor fixture with sample-admission coverage.

The integration runner creates disposable PostgreSQL databases. Do not run its fault-injection suites against a shared database. Docker is required.
