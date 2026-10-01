// db/ingest-week.mjs
// One-shot week import (operator CLI).
//
// Usage:  node db/ingest-week.mjs --season 2026 --week 4
// Env:    DATABASE_URL (required)
//
// Runs the ESPN-primary/nflverse-fallback import for one week synchronously
// and exits 0 on success, non-zero on failure. Useful for backfills and for
// production, where the queue worker is not deployed: run it via
//   fly ssh console -a <app> -C "node db/ingest-week.mjs --season 2026 --week 4"
// The db/ directory ships inside the production image for exactly this.

import { runWeek } from './ingest/run-week.mjs';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const season = Number(arg('season'));
const week = Number(arg('week'));
if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
  console.error('usage: node db/ingest-week.mjs --season <YYYY> --week <N>');
  process.exit(2);
}

try {
  const result = await runWeek({ season, week });
  // weekDigest() returns { counts, digest }; tolerate a plain string too.
  const digestHex =
    typeof result.digest === 'string' ? result.digest : result.digest?.digest;
  console.log(
    `ingest-week: season ${season} week ${week} OK — ` +
      `${result.gamesImported} games, ${result.recordsProcessed} records, ` +
      `${result.quarantined} quarantined, digest ${String(digestHex).slice(0, 12)}…`,
  );
} catch (err) {
  console.error(`ingest-week: season ${season} week ${week} FAILED:`, err?.message ?? err);
  process.exit(1);
}
