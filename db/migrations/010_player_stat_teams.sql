-- 010_player_stat_teams.sql
-- Phase 2 follow-up: attribute player_game_stats rows to their team.
--
-- The ESPN normalizer always knew each athlete's team (team_abbr on the
-- normalized row) but store.mjs dropped it at insert. Going forward the
-- column is populated at insert time; rows ingested before this migration
-- keep team_id NULL and the read path falls back to the game_leaders
-- attribution for those games.
--
-- Additive only: nullable column, no backfill in the migration itself.

ALTER TABLE player_game_stats
    ADD COLUMN team_id uuid REFERENCES teams (id) ON DELETE SET NULL;

CREATE INDEX player_game_stats_team_idx
    ON player_game_stats (game_id, team_id);
