# db/ — database schema, migrations, queue skeleton, dev seed (Phase 1B)

Schemas are plain versioned SQL. The Next.js app and worker use node built-ins
plus the `pg` package (installed at the repo root by sibling A).

## Layout

- `migrations/NNN_name.sql` — applied in filename order by `run-migrations.mjs`
- `run-migrations.mjs` — `node db/run-migrations.mjs` (needs `DATABASE_URL`)
- `worker.mjs` — queue worker skeleton; `node db/worker.mjs`
- `seed-dev.mjs` — **DEVELOPMENT FIXTURES ONLY**; refuses `NODE_ENV=production`

## Migrations

| File | Contents |
|---|---|
| `001_core.sql` | `pgcrypto` + `citext` extensions; `users`, `profiles`, `sessions`, `email_verification_tokens`, `password_reset_tokens`, `user_settings`; `pools`, `memberships` |
| `002_competition.sql` | `seasons`, `weeks`, `teams`, `games`, `game_result_revisions`, `picks` (+ immutability/team-guard triggers), `pick_revisions` (append-only), `participant_game_outcomes`, `import_batches` (immutable after confirm), `import_rows`, `weekly_scores`, `team_follows` (ranked fandom hierarchy) |
| `003_editorial.sql` | `news_items` (+ `news_item_teams`), `report_editions`, `report_entries`, `ranking_entries`, `source_citations`, `weekly_features`, `game_analyses`, `team_assessments`, `team_assessment_revisions` (append-only), `team_statement_assessments`, `review_requests`, `review_notifications` |
| `004_notifications.sql` | `notification_preferences`, `notification_team_mutes`, `push_devices`, `notification_events` (unique event_type+subject_id+source_revision), `notification_deliveries` (unique event_id+user_id+device_id) |
| `005_forum.sql` | `forum_categories`, `forum_topics`, `forum_replies`, `content_reports` |
| `006_sports_data.sql` | `provider_payloads` (immutable snapshots), `team_game_stats`, `player_game_stats`, `scoring_periods`, `team_injury_statuses`, `stat_snapshots`, `sync_runs` |
| `007_queue_audit.sql` | `jobs` (claim via `SELECT ... FOR UPDATE SKIP LOCKED`), `audit_log` (append-only) |

Applied migrations are recorded in `schema_migrations` (filename + sha256).
Editing an applied migration fails loudly — write a new migration instead.

## Auth contracts (sibling C — verbatim)

- `users(id uuid PK default gen_random_uuid(), email citext UNIQUE NOT NULL, password_hash text NOT NULL, email_verified_at timestamptz NULL, created_at/updated_at timestamptz default now())`
- `profiles(user_id uuid PK references users, display_name text UNIQUE NOT NULL, created_at/updated_at)`
- `sessions(id uuid PK, user_id fk users, token_hash text UNIQUE NOT NULL, created_at, expires_at, last_seen_at, revoked_at NULL)`
- `email_verification_tokens(id uuid PK, user_id fk, token_hash text UNIQUE NOT NULL, expires_at, consumed_at NULL, created_at)`
- `password_reset_tokens(id uuid PK, user_id fk, token_hash text UNIQUE NOT NULL, expires_at, consumed_at NULL, created_at)`
- `user_settings(user_id uuid PK references users, accent_source text NOT NULL DEFAULT 'team' CHECK (accent_source IN ('team','neutral')), luminance text NOT NULL DEFAULT 'system' CHECK (luminance IN ('light','dark','system')), timezone text NOT NULL DEFAULT 'America/Los_Angeles', updated_at)`

## Competition hardening

- `picks` unique `(user_id, game_id)`; trigger freezes `selected_team_id` once `committed_at` is set; trigger requires the selected team to play in the game.
- `pick_revisions`, `team_assessment_revisions`, `audit_log`: append-only triggers (reject UPDATE/DELETE).
- Append-only is intentional end-to-end: because revisions/audit rows cascade from
  `picks`/`games`, **deleting a game or pick is blocked by design** — history is
  preserved, never deleted. Account removal must anonymize (per the spec's
  privacy rules), not hard-delete.
- `team_follows`: unique `(user_id, team_id)` + partial unique `(user_id, rank_position)` WHERE active. Top active rank = effective favorite (derived, never stored).
- `import_batches`: immutable after `confirmed_at`.
- A miss is a `participant_game_outcomes` row with `outcome='miss'` — never a synthetic pick.

## Player identity

No `players` table yet (Phase 1 scope). `player_game_stats` and
`team_injury_statuses` use a stable `player_external_id text` (the provider's
player identifier) plus `player_name`. A dedicated players table is a later
expansion; normalized rows never depend on it.

## Queue

`jobs.payload.type` selects the handler. Phase 1 ships only `noop`. The claim
query uses `SELECT ... FOR UPDATE SKIP LOCKED` so N workers never double-claim.
Failed jobs retry until `max_attempts`, then park as `failed` with `last_error`.

## Extra tables beyond the sibling contract (implied by the spec)

- `pools` (membership target; spec decision #1: invite-only global pool for beta)
- `notification_team_mutes` (per-team mute for team-scoped event types)
- `news_item_teams` (team tagging for the News tab)
