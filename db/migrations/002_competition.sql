-- 002_competition.sql
-- Competition entities: seasons, weeks, teams, games, result revisions, picks,
-- pick audit history, per-game outcomes, historical import, weekly projections,
-- team follows. Includes the competition-hardening constraints and triggers.

-- Seasons ---------------------------------------------------------------------
CREATE TABLE seasons (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    league     text NOT NULL DEFAULT 'NFL',
    year       integer NOT NULL,
    label      text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (league, year)
);

-- Weeks ------------------------------------------------------------------------
CREATE TABLE weeks (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id    uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    number       integer NOT NULL,
    label        text,
    starts_at    timestamptz,
    ends_at      timestamptz,
    is_current   boolean NOT NULL DEFAULT false,
    published_at timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (season_id, number)
);
-- Only one current week per season. Advancing the pointer never deletes,
-- moves, or rewrites prior weekly pages.
CREATE UNIQUE INDEX weeks_one_current_per_season
    ON weeks (season_id) WHERE is_current;

-- Teams -------------------------------------------------------------------------
CREATE TABLE teams (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    abbreviation     text NOT NULL UNIQUE,
    name             text NOT NULL,
    city             text NOT NULL,
    conference       text,
    division         text,
    provider_team_id text UNIQUE,
    -- Theme tokens: luminance-tuned accent variants for the two-axis theme model.
    accent_light     text,
    accent_dark      text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Games --------------------------------------------------------------------------
CREATE TABLE games (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id          uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    week_id            uuid NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
    provider_game_id   text NOT NULL UNIQUE,
    away_team_id       uuid NOT NULL REFERENCES teams (id),
    home_team_id       uuid NOT NULL REFERENCES teams (id),
    scheduled_at       timestamptz NOT NULL,
    lock_at            timestamptz NOT NULL,
    started_at         timestamptz,
    completed_at       timestamptz,
    status             text NOT NULL DEFAULT 'scheduled'
        CHECK (status IN ('scheduled', 'live', 'final', 'postponed', 'cancelled')),
    venue              text,
    broadcast_text     text,
    source_updated_at  timestamptz,
    ingested_at        timestamptz NOT NULL DEFAULT now(),
    result_revision_id uuid,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CHECK (away_team_id <> home_team_id)
);
-- Ballot ordering: games of a week by scheduled time.
CREATE INDEX games_week_scheduled_idx ON games (week_id, scheduled_at);

-- Game result revisions: versioned outcomes; games.result_revision_id points at
-- the active one. Corrections create new revisions, never rewrite history. ----------
CREATE TABLE game_result_revisions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id          uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    revision_number  integer NOT NULL,
    home_score       integer,
    away_score       integer,
    winner_team_id   uuid REFERENCES teams (id),
    is_tie           boolean NOT NULL DEFAULT false,
    status           text NOT NULL DEFAULT 'official'
        CHECK (status IN ('official', 'provisional', 'corrected', 'voided')),
    source_updated_at timestamptz,
    recorded_at      timestamptz NOT NULL DEFAULT now(),
    correction_reason text,
    UNIQUE (game_id, revision_number)
);
CREATE INDEX game_result_revisions_game_idx ON game_result_revisions (game_id, revision_number);

ALTER TABLE games
    ADD CONSTRAINT games_result_revision_fk
    FOREIGN KEY (result_revision_id) REFERENCES game_result_revisions (id);

-- Picks ----------------------------------------------------------------------------
-- A pick is editable until committed_at is set (auto-commit 5 minutes before
-- kickoff, or at confirmation for historical_import). Once committed, the
-- selected team cannot change through ordinary application paths.
CREATE TABLE picks (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id                   uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    selected_team_id          uuid NOT NULL REFERENCES teams (id),
    created_at                timestamptz NOT NULL DEFAULT now(),
    updated_at                timestamptz NOT NULL DEFAULT now(),
    committed_at              timestamptz,
    lock_reason               text CHECK (lock_reason IN ('deadline', 'historical_import')),
    import_batch_id           uuid,
    grade                     text NOT NULL DEFAULT 'pending'
        CHECK (grade IN ('win', 'loss', 'tie', 'pending', 'void')),
    graded_against_revision_id uuid REFERENCES game_result_revisions (id),
    graded_at                 timestamptz,
    UNIQUE (user_id, game_id)
);
-- Gated locked-choice distributions for reveal queries.
CREATE INDEX picks_game_committed_idx
    ON picks (game_id, committed_at, selected_team_id);

-- Guard: the selected team must belong to the game.
CREATE OR REPLACE FUNCTION check_pick_team_in_game()
RETURNS trigger AS $$
DECLARE
    v_away uuid;
    v_home uuid;
BEGIN
    SELECT away_team_id, home_team_id INTO v_away, v_home
    FROM games WHERE id = NEW.game_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'picks: game % does not exist', NEW.game_id;
    END IF;
    IF NEW.selected_team_id <> v_away AND NEW.selected_team_id <> v_home THEN
        RAISE EXCEPTION 'picks: team % is not a participant of game %',
            NEW.selected_team_id, NEW.game_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER picks_team_in_game_trg
    BEFORE INSERT OR UPDATE OF selected_team_id, game_id ON picks
    FOR EACH ROW EXECUTE FUNCTION check_pick_team_in_game();

-- Guard: a committed pick's selected team is immutable to ordinary writes.
-- (Operator corrections go through a new pick revision, never an UPDATE.)
CREATE OR REPLACE FUNCTION freeze_committed_pick()
RETURNS trigger AS $$
BEGIN
    IF OLD.committed_at IS NOT NULL
       AND NEW.selected_team_id IS DISTINCT FROM OLD.selected_team_id THEN
        RAISE EXCEPTION 'picks: committed pick % is locked and cannot change selected_team_id',
            OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER picks_freeze_committed_trg
    BEFORE UPDATE ON picks
    FOR EACH ROW EXECUTE FUNCTION freeze_committed_pick();

-- Pick revisions: append-only audit history of every pick change ----------------------
CREATE TABLE pick_revisions (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pick_id                   uuid NOT NULL REFERENCES picks (id) ON DELETE CASCADE,
    revision_number           integer NOT NULL,
    selected_team_id          uuid NOT NULL REFERENCES teams (id),
    committed_at              timestamptz,
    lock_reason               text CHECK (lock_reason IN ('deadline', 'historical_import')),
    import_batch_id           uuid,
    grade                     text CHECK (grade IN ('win', 'loss', 'tie', 'pending', 'void')),
    graded_against_revision_id uuid REFERENCES game_result_revisions (id),
    graded_at                 timestamptz,
    change_reason             text,
    recorded_by               uuid REFERENCES users (id),
    recorded_at               timestamptz NOT NULL DEFAULT now(),
    UNIQUE (pick_id, revision_number)
);
CREATE INDEX pick_revisions_pick_idx ON pick_revisions (pick_id, revision_number);

CREATE OR REPLACE FUNCTION reject_append_only_write()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'table % is append-only: UPDATE/DELETE are not permitted',
        TG_TABLE_NAME;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pick_revisions_append_only_trg
    BEFORE UPDATE OR DELETE ON pick_revisions
    FOR EACH ROW EXECUTE FUNCTION reject_append_only_write();

-- Participant game outcomes: per-game ledger. A locked game with no saved
-- selection creates a 'miss' outcome — never a synthetic pick. Weekly/season
-- projections count a miss as a loss; ledger queries keep the miss label. -----------
CREATE TABLE participant_game_outcomes (
    id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id                   uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    season_id                 uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    week_id                   uuid NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
    outcome                   text NOT NULL
        CHECK (outcome IN ('win', 'loss', 'tie', 'miss', 'void')),
    graded_against_revision_id uuid REFERENCES game_result_revisions (id),
    graded_at                 timestamptz,
    created_at                timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, game_id)
);
CREATE INDEX participant_game_outcomes_week_idx
    ON participant_game_outcomes (week_id, user_id);

-- Historical import: operator-only, previewed, idempotent by checksum ------------------
CREATE TABLE import_batches (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    uploaded_by  uuid REFERENCES users (id),
    filename     text,
    checksum     text NOT NULL UNIQUE,
    status       text NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'previewed', 'confirmed', 'rejected')),
    rows_total   integer NOT NULL DEFAULT 0,
    rows_created integer NOT NULL DEFAULT 0,
    rows_unchanged integer NOT NULL DEFAULT 0,
    rows_replaced integer NOT NULL DEFAULT 0,
    rows_rejected integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    confirmed_at timestamptz
);

ALTER TABLE picks
    ADD CONSTRAINT picks_import_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES import_batches (id);

-- Guard: an import batch is immutable after confirmation; corrections create a
-- new batch or pick revision with the operator, reason, and prior value preserved.
CREATE OR REPLACE FUNCTION freeze_confirmed_import_batch()
RETURNS trigger AS $$
BEGIN
    IF OLD.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'import_batches: batch % is confirmed and immutable', OLD.id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER import_batches_freeze_confirmed_trg
    BEFORE UPDATE OR DELETE ON import_batches
    FOR EACH ROW EXECUTE FUNCTION freeze_confirmed_import_batch();

CREATE TABLE import_rows (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_batch_id  uuid NOT NULL REFERENCES import_batches (id) ON DELETE CASCADE,
    source_row_number integer NOT NULL,
    participant      text,
    season           text,
    week             text,
    away_team        text,
    home_team        text,
    selected_team    text,
    mapped_user_id   uuid REFERENCES users (id),
    mapped_game_id   uuid REFERENCES games (id),
    action           text NOT NULL DEFAULT 'pending'
        CHECK (action IN ('pending', 'created', 'unchanged', 'replaced', 'rejected')),
    error_message    text,
    pick_id          uuid REFERENCES picks (id),
    UNIQUE (import_batch_id, source_row_number)
);

ALTER TABLE pick_revisions
    ADD CONSTRAINT pick_revisions_import_batch_fk
    FOREIGN KEY (import_batch_id) REFERENCES import_batches (id);

-- Weekly scores: disposable cached projections, rebuildable from games, result
-- revisions, picks, eligibility, and participant game outcomes. -------------------------
CREATE TABLE weekly_scores (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    season_id   uuid NOT NULL REFERENCES seasons (id) ON DELETE CASCADE,
    week_id     uuid NOT NULL REFERENCES weeks (id) ON DELETE CASCADE,
    win_count   integer NOT NULL DEFAULT 0,
    loss_count  integer NOT NULL DEFAULT 0,
    tie_count   integer NOT NULL DEFAULT 0,
    miss_count  integer NOT NULL DEFAULT 0,
    projection_revision integer NOT NULL DEFAULT 1,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, week_id)
);
-- Standings ordering: weekly leaderboard by correct picks.
CREATE INDEX weekly_scores_standings_idx
    ON weekly_scores (week_id, win_count DESC);
CREATE INDEX weekly_scores_season_idx ON weekly_scores (season_id, user_id);

-- Team follows: ranked fandom hierarchy; top active rank is the effective
-- favorite (no separate favorite-team field anywhere). ----------------------------------
CREATE TABLE team_follows (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    team_id       uuid NOT NULL REFERENCES teams (id),
    rank_position integer NOT NULL CHECK (rank_position >= 1),
    active        boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, team_id)
);
-- Active rank positions are unique per user; reorder operations are atomic.
CREATE UNIQUE INDEX team_follows_active_rank_unique
    ON team_follows (user_id, rank_position) WHERE active;
CREATE INDEX team_follows_user_idx ON team_follows (user_id, active, rank_position);
