// db/grade/grade.mjs
// Phase 3: deadline lock sweep + grading + standings projection.
//
// One entry point: gradeWeek({ season, week }).
//
// What it does, in order, for every game of the season/week:
//   1. Lock sweep — for games whose lock_at has passed (server clock):
//        - commits every uncommitted saved pick
//          (committed_at = lock_at, lock_reason = 'deadline');
//        - records a 'miss' outcome for each eligible participant with no
//          saved pick. Eligible = active membership in the global pool with
//          membership.created_at <= game.lock_at. (memberships carry no
//          status history; this is the closest faithful reading of
//          "active at the game's lock_at".)
//      The sweep is idempotent: committed picks are never recommitted,
//      misses use ON CONFLICT DO NOTHING.
//   2. Grading — for final games with an active result revision:
//        - committed picks grade win/loss/tie against the revision;
//        - the participant_game_outcomes ledger is upserted (win/loss/tie);
//        - a corrected final (new result revision) regrades deterministically:
//          anything graded against an older revision is recomputed.
//        - canceled games void committed picks; postponed games stay pending.
//   3. Standings projection — weekly_scores is rebuilt from the outcomes
//      ledger for the week (it is a disposable cached projection).
//
// Scope rule: grading begins with the first week the operator grades.
// Weeks that locked before pick saving existed are pre-competition history
// and accrue no outcomes — a "miss" presumes the opportunity to pick.
// The sweep therefore only touches games of the graded week.
//
// Every read/write path treats lock_at as authoritative independently of
// this job (the API enforces the deadline on save and derives locked-ness
// from lock_at on read), so a delayed or missed run can never extend the
// pick window — it only delays bookkeeping.
//
// Only node built-ins + the `pg` package.

import pg from 'pg';

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('grade: DATABASE_URL is not set');
  return url;
}

/**
 * Eligible participants for a game: active members of the global pool whose
 * membership predates the game's lock_at.
 */
const ELIGIBLE_SQL = `
  SELECT m.user_id
  FROM memberships m
  JOIN pools p ON p.id = m.pool_id
  WHERE p.is_global
    AND m.status = 'active'
    AND m.created_at <= $1
`;

/**
 * Deadline sweep for one game: commit saved picks, record misses.
 * Returns { committed, misses }.
 */
export async function sweepGame(client, game) {
  const { id: gameId, season_id: seasonId, week_id: weekId } = game;

  // Canceled games never accrue misses; voiding happens in grading.
  if (game.status === 'cancelled') return { gameId: game.id, committed: 0, misses: 0 };

  const commitRes = await client.query(
    `UPDATE picks p
     SET committed_at = g.lock_at,
         lock_reason = 'deadline',
         updated_at = now()
     FROM games g
     WHERE p.game_id = g.id
       AND g.id = $1
       AND p.committed_at IS NULL`,
    [gameId]
  );

  const missRes = await client.query(
    `INSERT INTO participant_game_outcomes
       (user_id, game_id, season_id, week_id, outcome, graded_at)
     SELECT e.user_id, $2, $3, $4, 'miss', $5
     FROM (${ELIGIBLE_SQL}) e
     WHERE NOT EXISTS (
       SELECT 1 FROM picks p
       WHERE p.user_id = e.user_id AND p.game_id = $2
     )
     ON CONFLICT (user_id, game_id) DO NOTHING`,
    [game.lock_at, gameId, seasonId, weekId, game.lock_at]
  );

  return { gameId, committed: commitRes.rowCount ?? 0, misses: missRes.rowCount ?? 0 };
}

/**
 * Grade one final game against its active result revision.
 * Returns { graded } — picks (re)graded.
 */
export async function gradeGame(client, game) {
  const { id: gameId, season_id: seasonId, week_id: weekId } = game;

  if (game.status === 'cancelled') {
    // Canceled: committed picks void; no outcome for anyone else.
    await client.query(
      `UPDATE picks p
       SET grade = 'void', graded_against_revision_id = $2, graded_at = now(),
           updated_at = now()
       FROM games g
       WHERE p.game_id = g.id AND g.id = $1
         AND p.committed_at IS NOT NULL
         AND (p.grade IS DISTINCT FROM 'void'
              OR p.graded_against_revision_id IS DISTINCT FROM $2)`,
      [gameId, game.result_revision_id]
    );
    const voidRes = await client.query(
      `INSERT INTO participant_game_outcomes
         (user_id, game_id, season_id, week_id, outcome,
          graded_against_revision_id, graded_at)
       SELECT p.user_id, $1, $2, $3, 'void', $4, now()
       FROM picks p
       WHERE p.game_id = $1 AND p.committed_at IS NOT NULL
       ON CONFLICT (user_id, game_id) DO UPDATE SET
         outcome = 'void',
         graded_against_revision_id = EXCLUDED.graded_against_revision_id,
         graded_at = EXCLUDED.graded_at
       WHERE participant_game_outcomes.outcome IS DISTINCT FROM 'void'
          OR participant_game_outcomes.graded_against_revision_id
             IS DISTINCT FROM EXCLUDED.graded_against_revision_id`,
      [gameId, seasonId, weekId, game.result_revision_id]
    );
    return { graded: voidRes.rowCount ?? 0 };
  }

  if (game.status !== 'final' || !game.result_revision_id) return { graded: 0 };

  const rev = await client.query(
    `SELECT winner_team_id, is_tie FROM game_result_revisions WHERE id = $1`,
    [game.result_revision_id]
  );
  const revision = rev.rows[0];
  if (!revision) return { graded: 0 };

  // Grade the picks themselves.
  await client.query(
    `UPDATE picks p
     SET grade = CASE
                  WHEN $2 THEN 'tie'
                  WHEN p.selected_team_id = $3 THEN 'win'
                  ELSE 'loss'
                END,
         graded_against_revision_id = $4,
         graded_at = now(),
         updated_at = now()
     FROM games g
     WHERE p.game_id = g.id
       AND g.id = $1
       AND p.committed_at IS NOT NULL
       AND (p.graded_against_revision_id IS DISTINCT FROM $4
            OR p.grade = 'pending')`,
    [gameId, revision.is_tie, revision.winner_team_id, game.result_revision_id]
  );

  // Upsert the ledger from the graded picks.
  const ledgerRes = await client.query(
    `INSERT INTO participant_game_outcomes
       (user_id, game_id, season_id, week_id, outcome,
        graded_against_revision_id, graded_at)
     SELECT p.user_id, $1, $2, $3,
            CASE
              WHEN $4 THEN 'tie'
              WHEN p.selected_team_id = $5 THEN 'win'
              ELSE 'loss'
            END,
            $6, now()
     FROM picks p
     WHERE p.game_id = $1 AND p.committed_at IS NOT NULL
     ON CONFLICT (user_id, game_id) DO UPDATE SET
       outcome = EXCLUDED.outcome,
       graded_against_revision_id = EXCLUDED.graded_against_revision_id,
       graded_at = EXCLUDED.graded_at
     WHERE participant_game_outcomes.outcome IS DISTINCT FROM EXCLUDED.outcome
        OR participant_game_outcomes.graded_against_revision_id
           IS DISTINCT FROM EXCLUDED.graded_against_revision_id`,
    [
      gameId,
      seasonId,
      weekId,
      revision.is_tie,
      revision.winner_team_id,
      game.result_revision_id,
    ]
  );

  return { graded: ledgerRes.rowCount ?? 0 };
}

/**
 * Rebuild weekly_scores for one week from the outcomes ledger.
 * weekly_scores is a disposable cached projection.
 */
export async function recomputeWeeklyScores(client, seasonId, weekId) {
  const res = await client.query(
    `INSERT INTO weekly_scores
       (user_id, season_id, week_id, win_count, loss_count, tie_count,
        miss_count, projection_revision, updated_at)
     SELECT user_id, $1, $2,
            COUNT(*) FILTER (WHERE outcome = 'win'),
            COUNT(*) FILTER (WHERE outcome = 'loss'),
            COUNT(*) FILTER (WHERE outcome = 'tie'),
            COUNT(*) FILTER (WHERE outcome = 'miss'),
            1, now()
     FROM participant_game_outcomes
     WHERE week_id = $2
     GROUP BY user_id
     ON CONFLICT (user_id, week_id) DO UPDATE SET
       win_count = EXCLUDED.win_count,
       loss_count = EXCLUDED.loss_count,
       tie_count = EXCLUDED.tie_count,
       miss_count = EXCLUDED.miss_count,
       projection_revision = weekly_scores.projection_revision + 1,
       updated_at = EXCLUDED.updated_at`,
    [seasonId, weekId]
  );
  // Drop projections for participants with no outcomes left (e.g. after a
  // correction voids a week's only game).
  await client.query(
    `DELETE FROM weekly_scores ws
     WHERE ws.week_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM participant_game_outcomes o
         WHERE o.week_id = $1 AND o.user_id = ws.user_id
       )`,
    [weekId]
  );
  return { rows: res.rowCount ?? 0 };
}

/**
 * Grade a whole season/week: sweep locks, grade finals, rebuild projections.
 * Idempotent — safe to re-run; returns per-stage counts.
 */
export async function gradeWeek({ season, week }) {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const client = await pool.connect();
  try {
    const { rows: seasonRows } = await client.query(
      `SELECT id FROM seasons WHERE league = 'NFL' AND year = $1`,
      [season]
    );
    if (seasonRows.length === 0) {
      throw new Error(`grade: no NFL season ${season}`);
    }
    const seasonId = seasonRows[0].id;

    const { rows: weekRows } = await client.query(
      `SELECT id FROM weeks WHERE season_id = $1 AND number = $2`,
      [seasonId, week]
    );
    if (weekRows.length === 0) {
      throw new Error(`grade: season ${season} has no week ${week}`);
    }
    const weekId = weekRows[0].id;

    const { rows: games } = await client.query(
      `SELECT id, season_id, week_id, status, lock_at, result_revision_id
       FROM games
       WHERE week_id = $1
       ORDER BY scheduled_at`,
      [weekId]
    );

    const now = new Date();
    let swept = 0;
    let committed = 0;
    let misses = 0;
    let graded = 0;

    await client.query('BEGIN');
    try {
      for (const game of games) {
        if (new Date(game.lock_at) <= now) {
          const s = await sweepGame(client, game);
          swept += 1;
          committed += s.committed;
          misses += s.misses;
        }
        const g = await gradeGame(client, game);
        graded += g.graded;
      }
      await recomputeWeeklyScores(client, seasonId, weekId);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    return {
      season,
      week,
      games: games.length,
      swept,
      committed,
      misses,
      graded,
    };
  } finally {
    client.release();
    await pool.end();
  }
}
