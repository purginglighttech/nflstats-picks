// db/ingest/store.test.mjs
// Database tests for the ingestion store layer: idempotency, in-place
// updates, and result-revision versioning.
//
// These run against a real database (DATABASE_URL) inside rolled-back
// transactions using a synthetic season (2099) so they never touch real
// data. Skipped when DATABASE_URL is unset.
// Run: DATABASE_URL=... node --test db/ingest/

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';

import {
  ensureSeasonWeek,
  quarantine,
  sha256Hex,
  storePayload,
  teamIdsByAbbr,
  upsertGame,
  upsertInjuries,
  upsertLeaders,
  upsertPlayerStats,
  upsertScoringPeriods,
  upsertTeam,
  upsertTeamStats,
  weekDigest,
} from './store.mjs';
import { scoringPeriods } from './normalize.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
const SEASON = 2099;
const WEEK = 99;

let pool;

before(async () => {
  if (!DATABASE_URL) return;
  pool = new pg.Pool({ connectionString: DATABASE_URL });
});

/** Synthetic normalized game record (same shape as normalizeScoreboardEvent). */
function syntheticGame(overrides = {}) {
  const side = (abbr, name, score, winner, periods) => ({
    abbr, name, espn_team_id: `t-${abbr}`, score, winner,
    linescores: periods.map((points, i) => ({ period: i + 1, points })),
  });
  return {
    provider_game_id: 'espn:test-9001',
    season_year: SEASON,
    season_type: 2,
    week_number: WEEK,
    scheduled_at: '2099-09-10T00:20:00Z',
    status: 'final',
    venue: 'Test Stadium',
    neutral_site: false,
    broadcast_text: 'TEST',
    home: side('KC', 'Kansas City Chiefs', 27, true, [7, 10, 3, 7]),
    away: side('DEN', 'Denver Broncos', 24, false, [7, 7, 10, 0]),
    ...overrides,
  };
}

/** Import one synthetic game fully; returns game id. */
async function importGame(client, weekId, teamIds, game, payloadId) {
  // Teams are upserted from provider data (production self-sufficiency:
  // the import never depends on dev fixtures).
  for (const side of [game.home, game.away]) {
    if (!teamIds.has(side.abbr)) {
      teamIds.set(side.abbr, await upsertTeam(client, {
        abbr: side.abbr, name: side.name, espnTeamId: side.espn_team_id,
      }));
    }
  }
  const gameId = await upsertGame(
    client,
    { ...game, _weekId: weekId, _homeTeamId: teamIds.get('KC'), _awayTeamId: teamIds.get('DEN') },
    payloadId
  );
  const byRef = new Map([[game.provider_game_id, gameId]]);
  await upsertTeamStats(client, byRef, teamIds, [
    { game_ref: game.provider_game_id, team_abbr: 'KC', metric_key: 'totalYards', display_label: 'Total Yards', metric_value: 402, display_value: '402', unit: null, position: 0 },
    { game_ref: game.provider_game_id, team_abbr: 'KC', metric_key: 'third_down_conversions', display_label: '3rd (5-16)', metric_value: 5, display_value: '5-16', unit: null, position: 1 },
  ], payloadId);
  await upsertPlayerStats(client, byRef, teamIds, [
    { game_ref: game.provider_game_id, team_abbr: 'KC', player_external_id: 'espn:9991', player_name: 'Test Player', category_key: 'passing', metric_key: 'passing_completions', metric_value: 23, raw_value: '23/33' },
  ], payloadId);
  await upsertLeaders(client, byRef, teamIds, [
    { game_ref: game.provider_game_id, team_abbr: 'KC', category_key: 'passing', category_label: 'Passing', rank: 1, player_external_id: 'espn:9991', player_name: 'Test Player', display_value: '278 YDS', metric_value: 278 },
  ], payloadId);
  await upsertScoringPeriods(client, gameId, teamIds, scoringPeriods(game), payloadId);
  await upsertInjuries(client, teamIds, [
    { team_abbr: 'KC', player_external_id: 'espn:9992', player_name: 'Hurt Player', injury: 'Hamstring', status: 'Questionable', source_updated_at: null },
  ]);
  return gameId;
}

describe('sha256Hex', () => {
  it('is deterministic and key-order independent', () => {
    assert.equal(sha256Hex({ b: 1, a: 2 }), sha256Hex({ a: 2, b: 1 }));
    assert.notEqual(sha256Hex({ a: 2 }), sha256Hex({ a: 3 }));
  });
});

describe('storePayload', () => {
  it('dedupes identical payloads and versions changed ones', { skip: !DATABASE_URL }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const data = { events: [{ id: 1 }] };
      const a = await storePayload(client, {
        provider: 'espn', resourceType: 'scoreboard', providerObjectId: 'week-99',
        season: SEASON, week: WEEK, fetchedAt: new Date().toISOString(), data,
      });
      assert.equal(a.isNew, true);
      const b = await storePayload(client, {
        provider: 'espn', resourceType: 'scoreboard', providerObjectId: 'week-99',
        season: SEASON, week: WEEK, fetchedAt: new Date().toISOString(), data,
      });
      assert.equal(b.isNew, false);
      assert.equal(a.id, b.id);
      const c = await storePayload(client, {
        provider: 'espn', resourceType: 'scoreboard', providerObjectId: 'week-99',
        season: SEASON, week: WEEK, fetchedAt: new Date().toISOString(), data: { events: [{ id: 2 }] },
      });
      assert.equal(c.isNew, true);
      assert.notEqual(c.id, a.id);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('week import idempotency', () => {
  it('double import produces an identical digest', { skip: !DATABASE_URL }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { weekId } = await ensureSeasonWeek(client, SEASON, WEEK);
      const teamIds = await teamIdsByAbbr(client);

      const game = syntheticGame();
      const id1 = await importGame(client, weekId, teamIds, game, null);
      const d1 = await weekDigest(client, SEASON, WEEK);

      const id2 = await importGame(client, weekId, teamIds, game, null);
      const d2 = await weekDigest(client, SEASON, WEEK);

      assert.equal(id1, id2, 'same game row, no duplicate');
      assert.deepEqual(d2, d1, 'digest identical after re-import');
      assert.equal(d1.counts.games, 1);
      assert.equal(d1.counts.scoring_periods, 8);
      assert.equal(d1.counts.team_game_stats, 2);
      assert.equal(d1.counts.player_game_stats, 1);
      assert.equal(d1.counts.game_leaders, 1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('kickoff moves update the game in place; no duplicate rows', { skip: !DATABASE_URL }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { weekId } = await ensureSeasonWeek(client, SEASON, WEEK);
      const teamIds = await teamIdsByAbbr(client);

      const id1 = await importGame(client, weekId, teamIds, syntheticGame(), null);
      const moved = syntheticGame({ scheduled_at: '2099-09-10T04:20:00Z' });
      const id2 = await importGame(client, weekId, teamIds, moved, null);

      assert.equal(id1, id2);
      const { rows } = await client.query(
        'SELECT scheduled_at, lock_at FROM games WHERE id = $1',
        [id1]
      );
      assert.equal(new Date(rows[0].scheduled_at).toISOString(), '2099-09-10T04:20:00.000Z');
      assert.equal(
        new Date(rows[0].lock_at).toISOString(),
        '2099-09-10T04:15:00.000Z',
        'lock_at stays five minutes before kickoff'
      );
      const { rows: n } = await client.query(
        "SELECT count(*)::int AS n FROM games WHERE provider_game_id = 'espn:test-9001'"
      );
      assert.equal(n[0].n, 1, 'no duplicate game row');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('final score corrections create a new revision, never a rewrite', { skip: !DATABASE_URL }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { weekId } = await ensureSeasonWeek(client, SEASON, WEEK);
      const teamIds = await teamIdsByAbbr(client);

      const game = syntheticGame();
      const id1 = await importGame(client, weekId, teamIds, game, null);

      // Provider corrects the final score (stat correction).
      const corrected = syntheticGame();
      corrected.home.score = 30;
      corrected.away.score = 24;
      await importGame(client, weekId, teamIds, corrected, null);

      const { rows } = await client.query(
        `SELECT id, revision_number, home_score, away_score, status
         FROM game_result_revisions WHERE game_id = $1 ORDER BY revision_number`,
        [id1]
      );
      assert.equal(rows.length, 2);
      assert.deepEqual(
        rows.map((r) => [r.revision_number, r.home_score, r.away_score, r.status]),
        [[1, 27, 24, 'official'], [2, 30, 24, 'corrected']]
      );
      const { rows: g } = await client.query(
        'SELECT result_revision_id FROM games WHERE id = $1',
        [id1]
      );
      assert.equal(g[0].result_revision_id, rows[1].id, 'game points at the corrected revision');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('injuries replace the active set; quarantine stores bad rows', { skip: !DATABASE_URL }, async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { weekId } = await ensureSeasonWeek(client, SEASON, WEEK);
      const teamIds = await teamIdsByAbbr(client);

      await importGame(client, weekId, teamIds, syntheticGame(), null);
      // A later summary declares the team healthy: deactivates the old row.
      await upsertInjuries(client, teamIds, [], ['KC']);
      void weekId;
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM team_injury_statuses
         WHERE team_id = $1 AND active`,
        [teamIds.get('KC')]
      );
      assert.equal(rows[0].n, 0, 'empty declared set deactivates prior injuries');

      await quarantine(client, [{
        provider: 'espn', resource_type: 'team_stat',
        provider_object_id: 'x', reason: 'test quarantine', detail: { a: 1 },
      }]);
      const { rows: q } = await client.query(
        "SELECT reason, detail FROM ingest_quarantine WHERE provider_object_id = 'x'"
      );
      assert.equal(q.length, 1);
      assert.equal(q[0].reason, 'test quarantine');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});
