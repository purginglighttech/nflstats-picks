-- 011_picks_phase3.sql
-- Phase 3: picks + competition.
--
-- 1. The one invite-only global pool for beta (spec decision #1, "Confirmed
--    launch assumptions"). Reference data like the 32 teams: stable,
--    idempotent, safe to seed in production. Beta invites are operator-managed
--    (db/pool-members.mjs); registration does NOT auto-join, so "invite-only"
--    stays true.
-- 2. pick_idempotency_keys: PUT /games/[id]/pick takes an idempotency key per
--    the spec's request path. Same key + same payload replays the stored
--    result; same key + different payload is a 409.
-- 3. Index backing season-standings aggregation over the outcomes ledger.
--
-- Additive only. No backfill: grading begins with the first week the operator
-- grades (db/grade-week.mjs). Weeks that locked before pick saving existed
-- are pre-competition history and accrue no outcomes — a "miss" requires the
-- opportunity to pick.

-- The global pool ---------------------------------------------------------------
INSERT INTO pools (name, slug, is_global)
VALUES ('Global Pool', 'global', true)
ON CONFLICT (slug) DO NOTHING;

-- Pick idempotency keys ----------------------------------------------------------
CREATE TABLE pick_idempotency_keys (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    game_id         uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    idempotency_key text NOT NULL,
    pick_id         uuid NOT NULL REFERENCES picks (id) ON DELETE CASCADE,
    -- sha256 over the canonical request payload; a reused key with a different
    -- payload is rejected rather than silently applied.
    request_hash    text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, game_id, idempotency_key)
);
CREATE INDEX pick_idempotency_keys_lookup_idx
    ON pick_idempotency_keys (user_id, game_id);

-- Season standings read path ------------------------------------------------------
CREATE INDEX participant_game_outcomes_season_user_idx
    ON participant_game_outcomes (season_id, user_id);
