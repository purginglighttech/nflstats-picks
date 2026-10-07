// db/ingest-weekly.mjs
// Weekly scheduled import (operator CLI, designed for cron/GitHub Actions).
//
// Imports the two weeks that matter each Tuesday morning:
//   1. The current week (is_current): pulls finals; the post-import grading
//      in runWeek grades them and refreshes standings.
//   2. The next week (current + 1): pulls the upcoming schedule so the
//      ballot is ready before picks open.
//
// Usage:
//   DATABASE_URL=... node db/ingest-weekly.mjs
//
// Season and week are derived from the DB — no flags needed. Idempotent:
// re-running is safe (imports upsert, grading regrades deterministically).
// A missing next week (offseason) logs a warning and continues.
//
// Only node built-ins + the `pg` package.

import pg from 'pg';
import { runWeek } from './ingest/run-week.mjs';

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('ingest-weekly: DATABASE_URL is not set');
  return url;
}

/** Latest season year and the marked current week number. */
async function currentSeasonWeek() {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const client = await pool.connect();
  try {
    const { rows: seasons } = await client.query(
      `SELECT year FROM seasons WHERE league = 'NFL' ORDER BY year DESC LIMIT 1`
    );
    if (seasons.length === 0) throw new Error('no NFL season found');
    const season = seasons[0].year;
    const { rows: cur } = await client.query(
      `SELECT w.number
       FROM weeks w
       JOIN seasons s ON s.id = w.season_id
       WHERE s.league = 'NFL' AND s.year = $1 AND w.is_current
       LIMIT 1`,
      [season]
    );
    if (cur.length === 0) {
      throw new Error('no current week marked — run a manual ingest-week first');
    }
    return { season, currentWeek: cur[0].number };
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const { season, currentWeek } = await currentSeasonWeek();
  console.log(`ingest-weekly: season ${season}, current week ${currentWeek}`);

  for (const week of [currentWeek, currentWeek + 1]) {
    console.log(`ingest-weekly: importing season ${season} week ${week}…`);
    try {
      const result = await runWeek({ season, week });
      const digestHex =
        typeof result.digest === 'string' ? result.digest : result.digest?.digest;
      console.log(
        `ingest-weekly: week ${week} OK — ${result.gamesImported} games, ` +
          `${result.recordsProcessed} records, ${result.quarantined} quarantined, ` +
          `digest ${String(digestHex).slice(0, 12)}…`
      );
    } catch (err) {
      console.warn(`ingest-weekly: week ${week} failed: ${err.message}`);
    }
  }
  console.log('ingest-weekly: done');
}

main().catch((err) => {
  console.error(`ingest-weekly: FAILED: ${err.message}`);
  process.exit(1);
});
