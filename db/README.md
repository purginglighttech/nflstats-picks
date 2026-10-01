# db/ — database schema, migrations, ingestion pipeline, queue worker (Phase 2)

Schemas are plain versioned SQL. The Next.js app, worker, and ingestion scripts
use node built-ins plus the `pg` package (installed at the repo root).

## Layout

- `migrations/NNN_name.sql` — applied in filename order by `run-migrations.mjs`
- `run-migrations.mjs` — `node db/run-migrations.mjs` (needs `DATABASE_URL`)
- `worker.mjs` — queue worker; `node db/worker.mjs`
- `enqueue.mjs` — operator CLI for the queue (see Operator surface)
- `ingest/` — the game-data import pipeline (Phase 2)
  - `espn.mjs` — primary provider client (PoC-verified endpoints, polite rate)
  - `nflverse.mjs` — fallback provider client (team-level special-teams aggregates)
  - `normalize.mjs` — pure provider-payload -> record normalization
  - `store.mjs` — idempotent DB upserts (takes a pg client; no transactions)
  - `run-week.mjs` — orchestrates one week's import (used by the worker)
  - `*.test.mjs` — `node --test "db/ingest/*.test.mjs"` (unit + DB tests)
  - `fixtures/` — trimmed real provider payloads for hermetic unit tests
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
| `008_ingest_phase2.sql` | `game_leaders`, `ingest_quarantine`; `games.neutral_site`; `team_game_stats.display_value`, `player_game_stats.raw_value` (provider display strings, verbatim); `sync_runs.season/week` |

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

`jobs.payload.type` selects the handler. Phase 2 registers `ingest_week`
(`{ type, provider, season, week }`). The claim query uses
`SELECT ... FOR UPDATE SKIP LOCKED` so N workers never double-claim.
Failed jobs retry until `max_attempts`, then park as `failed` with `last_error`.

## Ingestion pipeline (Phase 2)

Standing data policy: ESPN primary, nflverse fallback (Phase 0 GO verdict).

```
enqueue ingest-week --season 2026 --week N
        │ inserts a jobs row (payload.type = 'ingest_week')
        ▼
worker ──► ingest_week handler ──► run-week.mjs
        1. fetch ESPN scoreboard (checksum-deduped into provider_payloads;
           raw bytes archived gzip-compressed under .raw-archive/)
        2. per game: fetch summary; normalize; upsert games, scoring
           periods, team/player stats, leaders, injuries — one transaction
           per game so a bad payload fails the game, not the week
        3. nflverse fallback fill: team-level special-teams aggregates ESPN
           lacks (punt_return_avg, kick_return_avg, field_goal_pct),
           stored as team_game_stats with category='weekly', provider note
           in source_payload_id. Failures degrade gracefully (quarantined,
           ESPN data unaffected)
        4. refresh the current-week pointer; finish the sync_runs row
```

Idempotency (the exit gate): re-importing a week changes nothing —
`provider_payloads` dedupes on `(provider, resource_type, object_id,
checksum)`; games upsert on `provider_game_id` with schedule/score changes
applied in place; final-score corrections create a new
`game_result_revisions` row (status `corrected`), never a rewrite. Verify
with `weekDigest` (counts + sha256 over the week's game rows).

Quarantine: anything the normalizer cannot handle (unknown team codes,
unknown status states, unparseable values) lands in `ingest_quarantine` with
the reason and context — never in competition facts.

Known gaps (documented, not silent):
- Net punt average is in neither ESPN's nor nflverse's weekly files; it
  stays unresolved until derived from play-by-play data (Phase 6).
- ESPN `broadcast` and `venue` arrive only in the scoreboard payload;
  post-import corrections to them update in place like any other field.

## Pre-game vs post-game summary semantics

ESPN's summary payload changes meaning with game status — the importer
accounts for this:
- Scheduled games: `leaders` are *season* leaders and `boxscore.teams`
  statistics are *season per-game averages* (8 keys like `yardsPerGame`,
  zero overlap with the 35 post-game game-stat keys). Leaders are NOT
  imported for scheduled games (they would masquerade as game leaders);
  the season-average team metrics are kept (distinct keys, no collision).
- Once a game is live/final, leaders and boxscore stats are game data and
  import normally; the final import upserts them in place.

## Operator surface

No sync dashboard UI in Phase 2; the operator surface is the CLI:

- `node db/enqueue.mjs ingest-week --season 2026 --week 4` — enqueue a week
- `node db/enqueue.mjs list` — recent jobs
- `node db/enqueue.mjs stale --season 2026 [--max-age-hours 24]` — stale-feed
  alarm: exits 2 when the current week's latest successful `ingest_week`
  sync is older than the limit (wire to a cron/monitor)

`lock_at` is always `scheduled_at - 5 minutes`, recomputed on every game
upsert. The current-week pointer is the earliest week (by kickoff) with a
non-final game, else the latest week with games; flipping it never touches
prior weekly pages.

## Extra tables beyond the sibling contract (implied by the spec)

- `pools` (membership target; spec decision #1: invite-only global pool for beta)
- `notification_team_mutes` (per-team mute for team-scoped event types)
- `news_item_teams` (team tagging for the News tab)
