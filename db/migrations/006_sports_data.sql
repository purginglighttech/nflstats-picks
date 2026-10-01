-- 006_sports_data.sql
-- Structured sports data: immutable provider payloads, normalized box-score
-- rows (all carrying their source payload ID for traceability), team injury
-- statuses, stat snapshots, and ingestion sync runs.

-- Provider payloads: immutable source snapshots. Reprocessing a stored payload
-- must reproduce the same normalized records for the same schema version.
-- raw_ref points at the compressed raw-response object in the archive tier;
-- the database keeps provenance metadata, not the raw body.
CREATE TABLE provider_payloads (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider           text NOT NULL,
    resource_type      text NOT NULL,
    provider_object_id text NOT NULL,
    season             integer,
    week               integer,
    fetched_at         timestamptz NOT NULL DEFAULT now(),
    source_updated_at  timestamptz,
    checksum           text NOT NULL,
    schema_version     text,
    raw_ref            text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (provider, resource_type, provider_object_id, checksum)
);
CREATE INDEX provider_payloads_lookup_idx
    ON provider_payloads (provider, resource_type, provider_object_id);

-- Team game stats: one typed metric per game and team ---------------------------
CREATE TABLE team_game_stats (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id         uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    team_id         uuid NOT NULL REFERENCES teams (id),
    metric_key      text NOT NULL,
    display_label   text,
    metric_value    numeric,
    unit            text,
    category        text,
    position        integer NOT NULL DEFAULT 0,
    source_payload_id uuid REFERENCES provider_payloads (id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, team_id, metric_key)
);

-- Player game stats: stable player mapping + category + metric keys.
-- player_external_id is the provider's stable player identifier (a dedicated
-- players table is a later expansion; normalized rows never depend on it).
CREATE TABLE player_game_stats (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id           uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    player_external_id text NOT NULL,
    player_name       text,
    category_key      text NOT NULL,
    metric_key        text NOT NULL,
    display_label     text,
    metric_value      numeric,
    unit              text,
    source_payload_id uuid REFERENCES provider_payloads (id),
    created_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, player_external_id, category_key, metric_key)
);

-- Scoring periods: quarter and overtime points ----------------------------------
CREATE TABLE scoring_periods (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id    uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    team_id    uuid NOT NULL REFERENCES teams (id),
    period_number integer NOT NULL CHECK (period_number >= 1),
    points     integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (game_id, team_id, period_number)
);

-- Team injury statuses: current declared injury facts. A missing source status
-- stays NULL in this contract; the product renders it as N/A, never as a
-- status-domain word.
CREATE TABLE team_injury_statuses (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id           uuid NOT NULL REFERENCES teams (id),
    player_external_id text NOT NULL,
    player_name       text,
    injury            text,
    status            text,
    source_revision   text,
    source_updated_at timestamptz,
    ingested_at       timestamptz NOT NULL DEFAULT now(),
    active            boolean NOT NULL DEFAULT true,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX team_injury_status_current_idx
    ON team_injury_statuses (team_id, player_external_id, active);
CREATE UNIQUE INDEX team_injury_status_one_active
    ON team_injury_statuses (team_id, player_external_id) WHERE active;

-- Stat snapshots: team context rows for team selection / season aggregates ------
CREATE TABLE stat_snapshots (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id         uuid NOT NULL REFERENCES teams (id),
    period_start    date,
    period_end      date,
    metric_key      text NOT NULL,
    metric_value    numeric,
    unit            text,
    source_payload_id uuid REFERENCES provider_payloads (id),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stat_snapshots_team_period_idx
    ON stat_snapshots (team_id, period_end DESC);

-- Sync runs: import observability (provider + job + time) -------------------------
CREATE TABLE sync_runs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider         text NOT NULL,
    job_name         text NOT NULL,
    started_at       timestamptz NOT NULL DEFAULT now(),
    finished_at      timestamptz,
    status           text NOT NULL DEFAULT 'running'
        CHECK (status IN ('running', 'succeeded', 'failed')),
    records_processed integer NOT NULL DEFAULT 0,
    error            text,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sync_runs_provider_job_idx
    ON sync_runs (provider, job_name, started_at DESC);
