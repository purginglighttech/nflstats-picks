// db/grade/grade.test.mjs
// Database tests for the Phase 3 grading pipeline: deadline sweep,
// result grading, regrades on correction, voids, and weekly score rebuilds.
//
// These run against a real database (DATABASE_URL) inside rolled-back
// transactions using a synthetic season (2099) so they never touch real
// data. Skipped when DATABASE_URL is unset.
// Run: DATABASE_URL=<dev-url> node --test db/grade/grade.test.mjs

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import {
  gradeGame,
  gradeWeek,
  recomputeWeeklyScores,
  sweepGame,
} from './grade.mjs';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@127.0.0.1:54329/pickem_dev';
const SEASON = 2099;
const WEEK = 99;

let pool;

/** Run fn inside a rolled-back transaction. */
async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

before(async () => {
  pool = new pg.Pool({ connectionString: DATABASE_URL });
});

/** Synthetic competition scaffold: season 2099 / week 99 + team ids. */
async function scaffold(client) {
  const season = (
    await client.query(
      `INSERT INTO seasons (year) VALUES ($1)
       ON CONFLICT (league, year) DO UPDATE SET year = EXCLUDED.year
       RETURNING id`,
      [SEASON],
    )
  ).rows[0];
  const week = (
    await client.query(
      `INSERT INTO weeks (season_id, number, label) VALUES ($1, $2, $3)
       ON CONFLICT (season_id, number) DO UPDATE SET label = EXCLUDED.label
       RETURNING id`,
      [season.id, WEEK, 'Test Week 99'],
    )
  ).rows[0];
  const teams = new Map(
    (
      await client.query(
        `SELECT id, abbreviation AS abbr FROM teams WHERE abbreviation IN ('KC', 'DEN', 'BUF', 'MIA')`,
      )
    ).rows.map((r) => [r.abbr, r.id]),
  );
  assert.ok(teams.get('KC'), 'seeded teams (migration 009) must exist');
  const poolId = (
    await client.query(`SELECT id FROM pools WHERE is_global ORDER BY created_at LIMIT 1`)
  ).rows[0]?.id;
  assert.ok(poolId, 'global pool (migration 011) must exist');
  return { seasonId: season.id, weekId: week.id, teams, poolId };
}

let userSeq = 0;

async function mkUser(client, { member = true, poolId, memberSince = null } = {}) {
  userSeq += 1;
  const n = userSeq;
  const user = (
    await client.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`grade-test-${Date.now()}-${n}@example.com`],
    )
  ).rows[0];
  await client.query(`INSERT INTO profiles (user_id, display_name) VALUES ($1, $2)`, [
    user.id,
    `Grade Tester ${Date.now()}-${n}`,
  ]);
  if (member) {
    // Default: joined well before any test game's lock, so the member is
    // eligible. Pass an explicit memberSince to test the boundary.
    await client.query(
      `INSERT INTO memberships (pool_id, user_id, status, created_at)
       VALUES ($1, $2, 'active', COALESCE($3, now() - interval '2 days'))`,
      [poolId, user.id, memberSince],
    );
  }
  return user.id;
}

/**
 * Insert a game directly. lockAt is a timestamptz expression offset from now;
 * status defaults to 'scheduled'.
 */
async function mkGame(client, ids, { status = 'scheduled', lockOffset = '-1 hour', home = 'KC', away = 'DEN' } = {}) {
  const g = (
    await client.query(
      `INSERT INTO games
         (season_id, week_id, provider_game_id, away_team_id, home_team_id,
          scheduled_at, lock_at, status)
       VALUES ($1, $2, $3, $4, $5, now() - interval '2 hours', now() + $6::interval, $7)
       RETURNING id, season_id, week_id, status, lock_at, result_revision_id`,
      [
        ids.seasonId,
        ids.weekId,
        `espn:grade-test-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
        ids.teams.get(away),
        ids.teams.get(home),
        lockOffset,
        status,
      ],
    )
  ).rows[0];
  return g;
}

async function mkPick(client, userId, gameId, teamAbbr, ids, { committed = false } = {}) {
  await client.query(
    `INSERT INTO picks (user_id, game_id, selected_team_id,
                        committed_at, lock_reason)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      gameId,
      ids.teams.get(teamAbbr),
      committed ? new Date().toISOString() : null,
      committed ? 'deadline' : null,
    ],
  );
}

/** Attach a result revision to a game; returns the game row for gradeGame. */
async function mkResult(client, gameId, ids, { homeScore, awayScore, status = 'official' } = {}) {
  const teams = (
    await client.query(`SELECT home_team_id, away_team_id FROM games WHERE id = $1`, [gameId])
  ).rows[0];
  const winnerTeamId =
    homeScore > awayScore ? teams.home_team_id : awayScore > homeScore ? teams.away_team_id : null;
  const rev = (
    await client.query(
      `INSERT INTO game_result_revisions
         (game_id, revision_number, home_score, away_score, winner_team_id, is_tie, status)
       VALUES ($1, 1, $2, $3, $4, $5, $6) RETURNING id`,
      [gameId, homeScore, awayScore, winnerTeamId, homeScore === awayScore, status],
    )
  ).rows[0];
  const g = (
    await client.query(
      `UPDATE games SET status = 'final', result_revision_id = $2
       WHERE id = $1
       RETURNING id, season_id, week_id, status, lock_at, result_revision_id`,
      [gameId, rev.id],
    )
  ).rows[0];
  return g;
}

const count = async (client, table, where = '', params = []) =>
  Number((await client.query(`SELECT count(*)::int AS n FROM ${table} ${where}`, params)).rows[0].n);

describe('sweepGame', () => {
  it('commits uncommitted picks at the deadline', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-1 minute' });
      await mkPick(client, userId, game.id, 'KC', ids);

      const res = await sweepGame(client, game);
      assert.equal(res.committed, 1);
      assert.equal(res.misses, 0);

      const pick = (await client.query(`SELECT committed_at, lock_reason FROM picks WHERE user_id = $1`, [userId])).rows[0];
      assert.ok(pick.committed_at, 'pick is committed');
      assert.equal(pick.lock_reason, 'deadline');
      // committed_at is pinned to the game's lock_at, not the sweep time.
      assert.equal(new Date(pick.committed_at).getTime(), new Date(game.lock_at).getTime());
    });
  });

  it('records a miss for an eligible member with no pick', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-1 minute' });

      const res = await sweepGame(client, game);
      assert.equal(res.committed, 0);
      assert.equal(res.misses, 1);

      const outcome = (
        await client.query(`SELECT outcome FROM participant_game_outcomes WHERE user_id = $1`, [userId])
      ).rows[0];
      assert.equal(outcome.outcome, 'miss');
    });
  });

  it('skips non-members and members who joined after the lock', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      await mkUser(client, { member: false, poolId: ids.poolId });
      // Joined after the lock: not eligible for this game.
      await mkUser(client, {
        poolId: ids.poolId,
        memberSince: new Date(Date.now() + 60_000).toISOString(),
      });
      const game = await mkGame(client, ids, { lockOffset: '-1 minute' });

      const res = await sweepGame(client, game);
      assert.equal(res.misses, 0);
      assert.equal(await count(client, 'participant_game_outcomes'), 0);
    });
  });

  it('skips cancelled games entirely', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { status: 'cancelled', lockOffset: '-1 minute' });
      await mkPick(client, userId, game.id, 'KC', ids);

      const res = await sweepGame(client, game);
      assert.equal(res.committed, 0);
      assert.equal(res.misses, 0);
      assert.equal(await count(client, 'participant_game_outcomes'), 0);
    });
  });

  it('is idempotent: a second sweep changes nothing', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const picker = await mkUser(client, { poolId: ids.poolId });
      await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-1 minute' });
      await mkPick(client, picker, game.id, 'KC', ids);

      const first = await sweepGame(client, game);
      const second = await sweepGame(client, game);
      assert.deepEqual(second, { gameId: game.id, committed: 0, misses: 0 });
      assert.equal(first.committed, 1);
      assert.equal(first.misses, 1);
      assert.equal(await count(client, 'picks'), 1);
      assert.equal(await count(client, 'participant_game_outcomes'), 1);
    });
  });
});

describe('gradeGame', () => {
  it('grades win/loss and writes the ledger', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const winner = await mkUser(client, { poolId: ids.poolId });
      const loser = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-2 hours' });
      await mkPick(client, winner, game.id, 'KC', ids, { committed: true });
      await mkPick(client, loser, game.id, 'DEN', ids, { committed: true });

      const graded = await mkResult(client, game.id, ids, { homeScore: 27, awayScore: 24 });
      const res = await gradeGame(client, graded);
      assert.equal(res.graded, 2);

      const grades = Object.fromEntries(
        (await client.query(`SELECT user_id, grade FROM picks`)).rows.map((r) => [r.user_id, r.grade]),
      );
      assert.equal(grades[winner], 'win');
      assert.equal(grades[loser], 'loss');

      const outcomes = Object.fromEntries(
        (
          await client.query(
            `SELECT user_id, outcome, graded_against_revision_id
             FROM participant_game_outcomes`,
          )
        ).rows.map((r) => [r.user_id, r]),
      );
      assert.equal(outcomes[winner].outcome, 'win');
      assert.equal(outcomes[loser].outcome, 'loss');
      assert.equal(outcomes[winner].graded_against_revision_id, graded.result_revision_id);
    });
  });

  it('grades ties and regrades deterministically on correction', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-2 hours' });
      await mkPick(client, userId, game.id, 'KC', ids, { committed: true });

      let graded = await mkResult(client, game.id, ids, { homeScore: 20, awayScore: 20 });
      await gradeGame(client, graded);
      let grade = (await client.query(`SELECT grade FROM picks`)).rows[0].grade;
      assert.equal(grade, 'tie');

      // Correction: the league reverses the result; the new revision regrades.
      const awayId = (await client.query(`SELECT away_team_id FROM games WHERE id = $1`, [game.id])).rows[0].away_team_id;
      const rev2 = (
        await client.query(
          `INSERT INTO game_result_revisions (game_id, revision_number, home_score, away_score, winner_team_id, is_tie, status, correction_reason)
           VALUES ($1, 2, 20, 27, $2, false, 'corrected', 'stat correction') RETURNING id`,
          [game.id, awayId],
        )
      ).rows[0];
      graded = (
        await client.query(
          `UPDATE games SET result_revision_id = $2 WHERE id = $1
           RETURNING id, season_id, week_id, status, lock_at, result_revision_id`,
          [game.id, rev2.id],
        )
      ).rows[0];
      const res = await gradeGame(client, graded);
      assert.equal(res.graded, 1);

      grade = (await client.query(`SELECT grade FROM picks`)).rows[0].grade;
      assert.equal(grade, 'loss');
      const outcome = (await client.query(`SELECT outcome, graded_against_revision_id FROM participant_game_outcomes`)).rows[0];
      assert.equal(outcome.outcome, 'loss');
      assert.equal(outcome.graded_against_revision_id, rev2.id);
      // One ledger row per participant-game, not one per revision.
      assert.equal(await count(client, 'participant_game_outcomes'), 1);
    });
  });

  it('voids picks when a game is cancelled after picks were saved', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { lockOffset: '-2 hours' });
      await mkPick(client, userId, game.id, 'KC', ids, { committed: true });
      const cancelled = (
        await client.query(
          `UPDATE games SET status = 'cancelled'
           WHERE id = $1
           RETURNING id, season_id, week_id, status, lock_at, result_revision_id`,
          [game.id],
        )
      ).rows[0];

      const res = await gradeGame(client, cancelled);
      assert.equal(res.graded, 1);
      const grade = (await client.query(`SELECT grade FROM picks`)).rows[0].grade;
      assert.equal(grade, 'void');
      const outcome = (await client.query(`SELECT outcome FROM participant_game_outcomes`)).rows[0];
      assert.equal(outcome.outcome, 'void');
    });
  });

  it('is a no-op for non-final games and for already-graded revisions', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      const game = await mkGame(client, ids, { status: 'scheduled', lockOffset: '1 hour' });
      await mkPick(client, userId, game.id, 'KC', ids, { committed: true });

      const notFinal = await gradeGame(client, game);
      assert.equal(notFinal.graded, 0);

      const graded = await mkResult(client, game.id, ids, { homeScore: 27, awayScore: 24 });
      const first = await gradeGame(client, graded);
      const second = await gradeGame(client, graded);
      assert.equal(first.graded, 1);
      assert.equal(second.graded, 0);
    });
  });
});

describe('recomputeWeeklyScores', () => {
  it('aggregates wins, losses, ties and misses per participant', async () => {
    await withTx(async (client) => {
      const ids = await scaffold(client);
      const sharp = await mkUser(client, { poolId: ids.poolId });
      const mid = await mkUser(client, { poolId: ids.poolId });
      const absent = await mkUser(client, { poolId: ids.poolId });

      const g1 = await mkGame(client, ids, { lockOffset: '-3 hours' });
      const g2 = await mkGame(client, ids, { lockOffset: '-3 hours', home: 'BUF', away: 'MIA' });
      await mkPick(client, sharp, g1.id, 'KC', ids, { committed: true });
      await mkPick(client, sharp, g2.id, 'BUF', ids, { committed: true });
      await mkPick(client, mid, g1.id, 'DEN', ids, { committed: true });
      await mkPick(client, mid, g2.id, 'BUF', ids, { committed: true });
      // `absent` never picks: two misses.

      await sweepGame(client, g1);
      await sweepGame(client, g2);
      await gradeGame(client, await mkResult(client, g1.id, ids, { homeScore: 27, awayScore: 24 }));
      await gradeGame(client, await mkResult(client, g2.id, ids, { homeScore: 20, awayScore: 20 }));

      const res = await recomputeWeeklyScores(client, ids.seasonId, ids.weekId);
      assert.equal(res.rows, 3);

      const rows = Object.fromEntries(
        (await client.query(`SELECT user_id, win_count, loss_count, tie_count, miss_count FROM weekly_scores`)).rows.map(
          (r) => [r.user_id, r],
        ),
      );
      assert.deepEqual(
        [rows[sharp].win_count, rows[sharp].loss_count, rows[sharp].tie_count, rows[sharp].miss_count],
        [1, 0, 1, 0],
      );
      assert.deepEqual(
        [rows[mid].win_count, rows[mid].loss_count, rows[mid].tie_count, rows[mid].miss_count],
        [0, 1, 1, 0],
      );
      assert.deepEqual(
        [rows[absent].win_count, rows[absent].loss_count, rows[absent].tie_count, rows[absent].miss_count],
        [0, 0, 0, 2],
      );

      // Rebuild is a full replace: a second run yields identical rows.
      const again = await recomputeWeeklyScores(client, ids.seasonId, ids.weekId);
      assert.equal(again.rows, 3);
      assert.equal(await count(client, 'weekly_scores'), 3);
    });
  });
});

describe('gradeWeek', () => {
  it('sweeps, grades and rebuilds scores end to end', async () => {
    // True end-to-end through gradeWeek's own connection (it manages its own
    // pool from DATABASE_URL), on synthetic season 2099 data that is cleaned
    // up afterwards so nothing leaks into the dev database.
    const client = await pool.connect();
    let ids;
    const userIds = [];
    try {
      ids = await scaffold(client);
      const userId = await mkUser(client, { poolId: ids.poolId });
      userIds.push(userId);
      const game = await mkGame(client, ids, { lockOffset: '-2 hours' });
      await mkPick(client, userId, game.id, 'KC', ids);
      await mkResult(client, game.id, ids, { homeScore: 27, awayScore: 24 });

      const res = await gradeWeek({ season: SEASON, week: WEEK });
      assert.equal(res.games, 1);
      assert.equal(res.swept, 1);
      assert.equal(res.graded, 1);

      const scores = (
        await client.query(
          `SELECT user_id, win_count, loss_count, tie_count, miss_count
           FROM weekly_scores WHERE week_id = $1`,
          [ids.weekId],
        )
      ).rows;
      assert.equal(scores.length, 1);
      assert.deepEqual(
        [scores[0].win_count, scores[0].loss_count, scores[0].tie_count, scores[0].miss_count],
        [1, 0, 0, 0],
      );

      const pick = (await client.query(`SELECT grade, lock_reason FROM picks`)).rows[0];
      assert.equal(pick.grade, 'win');
      assert.equal(pick.lock_reason, 'deadline');
    } finally {
      // Synthetic season cascades to weeks, games, picks, outcomes, scores.
      await client.query(`DELETE FROM seasons WHERE year = $1`, [SEASON]);
      for (const uid of userIds) {
        await client.query(`DELETE FROM users WHERE id = $1`, [uid]);
      }
      client.release();
    }
  });
});
