# @pickem/contracts

Shared versioned TypeScript domain types + zod schemas for the NFL pick'em
platform. Pure TypeScript — no browser or Node-only imports — so the same
package serves the Next.js web app and the future React Native client.

## Layout

- `src/index.ts` — package entrypoint; `export * as v1` plus the route manifest.
- `src/v1/` — the v1 contract version:
  - `common.ts` — `ApiError` envelope, ids, the 32-team list, pagination, error codes.
  - `auth.ts` — register / signin / verify / forgot-password / reset-password / me.
  - `me.ts` — profile, settings (theme model), ranked team follows,
    notification preferences, push devices.
  - `competition.ts` — weeks, games, picks, standings, comparison ledger
    (shapes only; scoring/locking logic is server-owned, Phase 3+).
  - `editorial.ts` — news, report editions, ranking editions, team tab payloads.
  - `routes.ts` — `ROUTES_V1`: path → method → `{ auth, rateLimit, body/query/params }`.

## Conventions

- Types are derived from zod schemas via `z.infer` — the schema is the source
  of truth, never a parallel hand-written interface.
- Team identity on the wire is the uppercase abbreviation (`"KC"`); the
  database keys teams by uuid and the server resolves abbreviation ↔ uuid.
- Washington's abbreviation is `"WAS"`, matching the seeded `teams` table
  (sibling B). (Note: `apps/web/src/lib/theme/teams.ts` currently uses `wsh` —
  that map needs to align to `WAS`.)
- `push_devices.platform` is `"ios" | "android"` only, matching the database
  CHECK constraint; the raw provider token is never part of any response.

## Versioning

New contract versions live alongside `v1` (e.g. `src/v2/`) and are exported
as a new namespace. Routes migrate individually; no flag day.

## Scripts

- `npm run typecheck` — `tsc --noEmit`
- `npm run build` — `tsc` with declaration output to `dist/`
