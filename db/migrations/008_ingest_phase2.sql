-- 008_ingest_phase2.sql
-- Phase 2 ingestion tables and fidelity columns.
--
-- Additive only: no existing table is altered in a breaking way.
--   - game_leaders: per-game category leaders (Phase 2 backfill includes leaders).
--   - ingest_quarantine: invalid provider data goes here, never into competition
--     facts. A quarantine row is the alert surface (see db/enqueue.mjs `stale`).
--   - games.neutral_site: captured from the provider schedule payload.
--   - team_game_stats.display_value: the provider's display string, preserved
--     verbatim next to the parsed numeric (e.g. "5-16" for 3rd-down efficiency).
--   - player_game_stats.raw_value: the provider's raw display string, preserved
--     verbatim (e.g. "23/33" completions/attempts) next to parsed numerics.

CREATE TABLE game_leaders (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id           uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    team_id           uuid NOT NULL REFERENCES teams (id),
    category_key      text NOT NULL,
    category_label    text,
    rank              integer NOT NULL CHECK (rank >= 1),
    player_external_id text,
    player_name       text,
    display_value     text,
    metric_value      numeric,
    source_payload_id uuid REFERENCES provider_payloads (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, team_id, category_key, rank)
);
CREATE INDEX game_leaders_game_idx ON game_leaders (game_id, team_id);

CREATE TABLE ingest_quarantine (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           text NOT NULL,
    resource_type      text NOT NULL,
    provider_object_id text,
    reason             text NOT NULL,
    detail             jsonb,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingest_quarantine_lookup_idx
    ON ingest_quarantine (provider, resource_type, provider_object_id);

ALTER TABLE games ADD COLUMN neutral_site boolean NOT NULL DEFAULT false;
ALTER TABLE team_game_stats ADD COLUMN display_value text;
ALTER TABLE player_game_stats ADD COLUMN raw_value text;

-- sync_runs gains the season/week the run targeted so the operator's
-- stale-feed alarm (db/enqueue.mjs `stale`) can find the current week's
-- latest successful sync.
ALTER TABLE sync_runs ADD COLUMN season integer;
ALTER TABLE sync_runs ADD COLUMN week integer;
