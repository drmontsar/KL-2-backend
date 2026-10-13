# KliniK backend

API and database for the KliniK doctor frontend in `../KL-phase2-doctor`.

```bash
bun install
cp .env.example .env
docker compose up -d
bun run migrate
bun run seed
bun run server
```

The API runs at `http://localhost:3001`; OpenAPI docs are at `/docs`.
Logs are formatted with `pino-pretty` locally and emitted as JSON when `NODE_ENV=production`.
`bun run seed` replaces clinical data and is intended for local development only.
