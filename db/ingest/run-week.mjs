// db/ingest/run-week.mjs
// Orchestrates one week's import: ESPN scoreboard + per-game summaries,
// then the nflverse special-teams fallback fill, then the current-week
// pointer. Used by the worker's `ingest_week` handler and by tests.
//
// Transaction discipline:
//   - one sync_runs row per run (outside transactions);
//   - each game's scoreboard+summary import in its own transaction so a bad
//     payload fails the game, not the week;
//   - the nflverse fill in one transaction;
//   - current-week refresh last, still inside the same job.
//
// Raw snapshots: gzip-compressed provider responses under
// PICKEM_RAW_ARCHIVE (default ./.raw-archive, gitignored); provider_payloads
// carries raw_ref so any fact can be traced back to its source bytes.

import { createGzip } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import pg from 'pg';

import { fetchScoreboard, fetchSummary } from './espn.mjs';
import { fetchTeamWeek as fetchNflverseTeamWeek } from './nflverse.mjs';
import {
  normalizeScoreboardEvent,
  normalizeSummary,
  scoringPeriods,
  NFL_TEAMS,
} from './normalize.mjs';
import {
  ensureSeasonWeek,
  finishSyncRun,
  quarantine,
  recordSyncRun,
  refreshCurrentWeek,
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

const PROVIDER = 'espn';

export function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function archiveDir() {
  return resolve(process.env.PICKEM_RAW_ARCHIVE || join(process.cwd(), '.raw-archive'));
}

function safeName(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
}

/** Write the raw provider response bytes to the archive; returns raw_ref. */
export async function archivePayload(provider, resourceType, objectId, payload) {
  const dir = archiveDir();
  const rel = join(provider, resourceType, `${safeName(objectId)}.json.gz`);
  const full = join(dir, rel);
  await mkdir(dirname(full), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  await pipeline(Readable.from([bytes]), createGzip({ level: 9 }), createWriteStream(full));
  return rel;
}

/**
 * Import one regular-season week. Options:
 *   { season, week, provider='espn' }
 * Returns { digest, recordsProcessed, quarantined, gamesImported }.
 */
export async function runWeek({ season, week, provider = PROVIDER }) {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const client = await pool.connect();
  let syncRunId = null;
  let recordsProcessed = 0;
  let quarantined = 0;
  let gamesImported = 0;
  try {
    syncRunId = await recordSyncRun(client, { provider, jobName: 'ingest_week', season, week });

    const { weekId } = await ensureSeasonWeek(client, season, week);

    // --- Scoreboard: the week's games -----------------------------------
    const sb = await fetchScoreboard(week);
    const sbRawRef = await archivePayload(provider, 'scoreboard', `week-${week}`, sb);
    const sbStore = await storePayload(client, {
      provider,
      resourceType: 'scoreboard',
      providerObjectId: `week-${week}`,
      season,
      week,
      fetchedAt: sb.provenance.fetched_at,
      data: sb.data,
      rawRef: sbRawRef,
    });
    recordsProcessed += 1;

    const quarantines = [];
    const events = (sb.data.events || [])
      .map((ev) => normalizeScoreboardEvent(ev, quarantines))
      .filter(Boolean);

    // Teams first (production self-sufficiency: no dev fixtures required).
    const teamIds = await teamIdsByAbbr(client);
    for (const g of events) {
      for (const side of [g.home, g.away]) {
        if (!teamIds.has(side.abbr)) {
          const id = await upsertTeam(client, {
            abbr: side.abbr,
            name: side.name,
            espnTeamId: side.espn_team_id,
          });
          teamIds.set(side.abbr, id);
        }
      }
    }

    const gameIdByRef = new Map();
    for (const g of events) {
      const tx = await pool.connect();
      try {
        await tx.query('BEGIN');
        const gameQuarantines = [];
        const gameId = await upsertGame(
          tx,
          {
            ...g,
            _weekId: weekId,
            _homeTeamId: teamIds.get(g.home.abbr),
            _awayTeamId: teamIds.get(g.away.abbr),
          },
          sbStore.id
        );
        gameIdByRef.set(g.provider_game_id, gameId);
        recordsProcessed += 1;

        // Per-game summary (box score, leaders, injuries).
        const eventId = g.provider_game_id.split(':')[1];
        const sum = await fetchSummary(eventId);
        const sumRawRef = await archivePayload(provider, 'summary', eventId, sum);
        const sumStore = await storePayload(tx, {
          provider,
          resourceType: 'summary',
          providerObjectId: eventId,
          season,
          week,
          fetchedAt: sum.provenance.fetched_at,
          data: sum.data,
          rawRef: sumRawRef,
        });
        const norm = normalizeSummary(eventId, sum.data, gameQuarantines);
        await upsertTeamStats(tx, gameIdByRef, teamIds, norm.teamStats, sumStore.id);
        await upsertPlayerStats(tx, gameIdByRef, teamIds, norm.playerStats, sumStore.id);
        // Pre-game summaries list *season* leaders, not game leaders —
        // importing those as game_leaders would be a wrong semantic.
        // Leaders are only meaningful once the game is underway or final
        // (the final import upserts them in place).
        if (g.status !== 'scheduled') {
          await upsertLeaders(tx, gameIdByRef, teamIds, norm.leaders, sumStore.id);
        }
        await upsertScoringPeriods(tx, gameId, teamIds, scoringPeriods(g), sbStore.id);
        await upsertInjuries(tx, teamIds, norm.injuries, norm.injuryTeams);
        await quarantine(tx, gameQuarantines);
        quarantined += gameQuarantines.length;
        recordsProcessed +=
          norm.teamStats.length + norm.playerStats.length + norm.leaders.length + norm.injuries.length;

        await tx.query('COMMIT');
        gamesImported += 1;
      } catch (err) {
        await tx.query('ROLLBACK');
        throw err;
      } finally {
        tx.release();
      }
    }
    await quarantine(client, quarantines);
    quarantined += quarantines.length;

    // --- nflverse fallback: team-level special-teams aggregates -----------
    try {
      const nv = await fetchNflverseTeamWeek(season, week);
      const byTeamGame = new Map();
      for (const g of events) {
        byTeamGame.set(g.home.abbr, gameIdByRef.get(g.provider_game_id));
        byTeamGame.set(g.away.abbr, gameIdByRef.get(g.provider_game_id));
      }
      const nvQuarantines = [];
      const nvRows = [];
      const seenUnknownCodes = new Set();
      let byeSkips = 0;
      for (const r of nv.rows) {
        const gameId = byTeamGame.get(r.team_abbr);
        if (!gameId) {
          if (NFL_TEAMS.has(r.team_abbr)) {
            // Bye week: expected, not a data anomaly — skip quietly.
            byeSkips += 1;
          } else if (!seenUnknownCodes.has(r.team_abbr)) {
            seenUnknownCodes.add(r.team_abbr);
            nvQuarantines.push({
              provider: 'nflverse',
              resource_type: 'team_week_stats',
              provider_object_id: `week-${week}`,
              reason: `unknown nflverse team code ${JSON.stringify(r.team_abbr)}`,
              detail: { team: r.team_abbr },
            });
          }
          continue;
        }
        nvRows.push({ ...r, game_ref: `nflverse:${week}:${r.team_abbr}` });
      }
      if (byeSkips > 0) {
        console.log(`ingest_week season=${season} week=${week}: nflverse skipped ${byeSkips} bye-week rows`);
      }
      const nvTx = await pool.connect();
      try {
        await nvTx.query('BEGIN');
        const nvPayload = await storePayload(nvTx, {
          provider: 'nflverse',
          resourceType: 'team_week',
          providerObjectId: `week-${week}`,
          season,
          week,
          fetchedAt: nv.provenance.fetched_at,
          data: { endpoint: nv.provenance.endpoint, rowCount: nv.rows.length },
          rawRef: null,
        });
        const gameRefToId = new Map(nvRows.map((r) => [r.game_ref, byTeamGame.get(r.team_abbr)]));
        for (const r of nvRows) {
          const teamId = teamIds.get(r.team_abbr);
          if (!teamId) continue;
          await nvTx.query(
            `INSERT INTO team_game_stats
               (game_id, team_id, metric_key, display_label, metric_value,
                unit, category, display_value, source_payload_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'weekly', $7, $8)
             ON CONFLICT (game_id, team_id, metric_key) DO UPDATE SET
               metric_value = EXCLUDED.metric_value,
               display_value = EXCLUDED.display_value,
               source_payload_id = EXCLUDED.source_payload_id`,
            [gameRefToId.get(r.game_ref), teamId, r.metric_key, r.metric_key,
             r.metric_value, r.unit, r.display_value, nvPayload.id]
          );
        }
        await quarantine(nvTx, nvQuarantines);
        await nvTx.query('COMMIT');
        quarantined += nvQuarantines.length;
        recordsProcessed += nvRows.length;
      } catch (err) {
        await nvTx.query('ROLLBACK');
        throw err;
      } finally {
        nvTx.release();
      }
    } catch (err) {
      // The fallback is additive: its failure must never take down the
      // ESPN import that already committed.
      await quarantine(client, [{
        provider: 'nflverse',
        resource_type: 'team_week',
        provider_object_id: `week-${week}`,
        reason: `nflverse fallback unavailable: ${err.message}`,
        detail: null,
      }]);
      quarantined += 1;
    }

    await refreshCurrentWeek(client, season);

    const digest = await weekDigest(client, season, week);
    await finishSyncRun(client, syncRunId, { status: 'succeeded', recordsProcessed });
    return { digest, recordsProcessed, quarantined, gamesImported };
  } catch (err) {
    if (syncRunId) {
      await finishSyncRun(client, syncRunId, { status: 'failed', recordsProcessed, error: err.message });
    }
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
