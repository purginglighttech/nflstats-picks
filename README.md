# NFL Pick'em Website — Phase 1 Foundation

A mobile-first NFL information hub + weekly pick'em competition, built as a
modular monolith: **Next.js 15 + TypeScript (strict)** web app, **PostgreSQL**,
and a **database-backed worker queue**. This repo is the Phase 1 foundation —
repository, workspaces, environments, CI, schema-migration workflow, and the
deployment pipeline config.

The product spec lives outside this repo at
`~/workspace/goals/nfl-pick-em-website/files/nfl-pickem-design-spec/` and is
the authority on product behavior. Phase 0 (provider proof of concept) is
done; this is Phase 1 workstream A.

## Quickstart (local dev)

Prerequisites: Node.js 24+ and npm. No system PostgreSQL needed — local dev
uses a real embedded PostgreSQL cluster.

```sh
npm install            # installs ALL workspace dependencies (only run at root)
cp .env.example .env   # optional — the defaults below already match

npm run db:start       # launch embedded Postgres (127.0.0.1:54329, background)
npm run db:migrate     # apply db/migrations/*.sql in order
npm run db:seed:dev    # clearly labeled DEVELOPMENT fixtures only
npm run dev            # Next.js dev server → http://localhost:3000
```

Database connection: `postgres://postgres:postgres@127.0.0.1:54329/pickem_dev`
(override with `DATABASE_URL`; the db:* scripts default to it when unset).
Data lives in `./.pgdata-dev` (gitignored). If you run as **root**, the db
script re-executes itself as the unprivileged `postgres` system user, since
PostgreSQL refuses root. If the default data dir isn't writable in your
environment, set `PICKEM_DB_DATADIR` to a writable path.

Useful commands:

| Command               | What it does                                           |
| --------------------- | ------------------------------------------------------ |
| `npm run db:start`    | Start the dev database (idempotent)                    |
| `npm run db:stop`     | Stop the dev database (idempotent)                     |
| `npm run db:migrate`  | Run migrations (`db/run-migrations.mjs`)               |
| `npm run db:seed:dev` | Load dev fixtures (`db/seed-dev.mjs`, never in prod)   |
| `npm run db:reset`    | Drop + recreate `public` schema, then migrate and seed |
| `npm run worker`      | Run the queue worker skeleton (`db/worker.mjs`)        |
| `npm run typecheck`   | `tsc --noEmit` in every workspace                      |
| `npm run lint`        | ESLint in every workspace                              |
| `npm run test`        | Vitest                                                 |
| `npm run build`       | Build every workspace                                  |

## Workspace layout

```
app/
├── apps/web/                 # Next.js 15 App Router, TS strict, Tailwind, src/ dir, @/* alias
│   ├── src/                  # (workstream D: web shell + theme)
│   ├── Dockerfile            # production image (Next.js standalone output)
│   └── fly.toml              # Fly.io config — CONFIG ONLY, deploy blocked (see below)
├── packages/contracts/       # pure TS: versioned API schemas (zod) + shared domain types
│                             # (workstream C owns: auth + API contracts)
├── db/                       # migrations, runner, dev seed, queue worker skeleton
│                             # (workstream B owns)
├── scripts/db.mjs            # local dev database control (start/stop/reset)
├── .github/workflows/ci.yml  # push/PR: migrations on empty DB, typecheck, lint, test, build
└── .env.example              # documented env vars — never commit a real .env
```

Where each workstream's pieces live:

- **A (scaffold/tooling/CI/deploy config):** this README, root `package.json`,
  `scripts/db.mjs`, `.github/workflows/ci.yml`, `apps/web/Dockerfile`,
  `apps/web/fly.toml`, `apps/web/next.config.ts` (`output: "standalone"`).
- **B (SQL migrations):** `db/` — `migrations/NNN_name.sql` (applied in
  filename order), `run-migrations.mjs`, `seed-dev.mjs`, `worker.mjs`. See
  `db/README.md`.
- **C (auth + API contracts):** `packages/contracts/` — v1 zod schemas and
  shared types; keeps web rendering separate from server-owned competition
  rules, with a clean path for the future React Native client.
- **D (web shell + theme):** `apps/web/src/` — mobile-first shell, theme model.

**Dependency rule:** workstream A owns `npm install`. Siblings never run it;
if a package is needed, report it to the parent agent and A will add it.

## Environments

Per the spec, four environments with **separate databases and credentials**:

| Environment | Purpose                            | Database          |
| ----------- | ---------------------------------- | ----------------- |
| local       | Day-to-day development             | embedded-postgres |
| preview     | Per-change review builds (planned) | managed Postgres  |
| staging     | Pre-release verification (planned) | managed Postgres  |
| production  | Beta users (planned)               | managed Postgres  |

Staging/production databases do not exist yet — they are provisioned at
deploy time.

## Deployment — BLOCKED

Deployment is **blocked pending the user's Fly.io credentials**. Nothing in
this repo deploys anywhere: `apps/web/fly.toml` and `apps/web/Dockerfile`
are configuration only, and no credentials are stored here.

When unblocked, the release policy (per spec) is:

1. **Migrations run before code deploy**, against the target environment's
   database, and must be **backward-compatible only** — the old code keeps
   running against the migrated schema until the new code is live.
2. Each environment gets its own database and credentials (staging and
   production are never shared).
3. Seed fixtures (`db:seed:dev`) are development-only and refuse
   `NODE_ENV=production`.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: Node 24,
`npm ci`, a `postgres:16` service, **migrations against an empty database**,
`typecheck`, `eslint`, `vitest`, and `next build`.

## License

MIT
