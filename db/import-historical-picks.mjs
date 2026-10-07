// db/import-historical-picks.mjs
// One-shot historical picks import (operator CLI).
//
// The paper-ballot era predates the website: this backfills genuine past
// picks so grading and standings cover the full season. Imported picks are
// committed immediately with lock_reason='historical_import' — they were
// locked on paper back then, so there is no editing them now.
//
// Usage:
//   DATABASE_URL=... node db/import-historical-picks.mjs --csv picks.csv [--dry-run]
//
// CSV header (case-insensitive, order-insensitive):
//   participant,season,week,away_team,home_team,selected_team
//   - participant: the member's login email (matched case-insensitively)
//   - season: year, e.g. 2026
//   - week: week number, e.g. 1
//   - away_team / home_team / selected_team: team abbreviations, e.g. KC
//
// For each row the script resolves the user, the game, and the selected
// team, validates the selected team played in that game, and inserts the
// pick with committed_at = the game's lock_at (the paper deadline).
// Idempotent: re-running skips picks that already exist.
// --dry-run validates every row and reports counts without writing.
//
// Only node built-ins + the `pg` package.

import { readFileSync } from 'node:fs';
import pg from 'pg';

function databaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('import-historical-picks: DATABASE_URL is not set');
  return url;
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--csv') out.csv = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else usage();
  }
  if (!out.csv) usage();
  return out;
}

function usage() {
  console.error(
    'usage: node db/import-historical-picks.mjs --csv <path> [--dry-run]'
  );
  process.exit(2);
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const required = [
    'participant',
    'season',
    'week',
    'away_team',
    'home_team',
    'selected_team',
  ];
  for (const col of required) {
    if (!header.includes(col)) {
      throw new Error(`CSV is missing required column: ${col}`);
    }
  }
  return lines.slice(1).map((line, i) => {
    const cells = line.split(',').map((c) => c.trim());
    const row = {};
    for (let j = 0; j < header.length; j++) row[header[j]] = cells[j] ?? '';
    row._line = i + 2;
    return row;
  });
}

async function main() {
  const { csv, dryRun } = parseArgs(process.argv.slice(2));
  const rows = parseCsv(readFileSync(csv, 'utf8'));

  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const client = await pool.connect();
  try {
    let imported = 0;
    let skipped = 0;
    const errors = [];

    // Cache lookups: users by email, teams by abbreviation.
    const { rows: users } = await client.query(
      `SELECT id, email FROM users`
    );
    const userByEmail = new Map(
      users.map((u) => [u.email.toLowerCase(), u.id])
    );
    const { rows: teams } = await client.query(
      `SELECT id, abbreviation FROM teams`
    );
    const teamByAbbr = new Map(
      teams.map((t) => [t.abbreviation.toUpperCase(), t.id])
    );

    await client.query('BEGIN');
    try {
      for (const row of rows) {
        const tag = `line ${row._line}`;
        const fail = (msg) => errors.push(`${tag}: ${msg}`);

        const userId = userByEmail.get(
          (row.participant || '').toLowerCase()
        );
        if (!userId) {
          fail(`unknown participant email ${JSON.stringify(row.participant)}`);
          continue;
        }

        const seasonYear = Number(row.season);
        const weekNumber = Number(row.week);
        if (!Number.isInteger(seasonYear) || !Number.isInteger(weekNumber)) {
          fail(`bad season/week ${JSON.stringify(row.season)}/${JSON.stringify(row.week)}`);
          continue;
        }

        const awayAbbr = (row.away_team || '').toUpperCase();
        const homeAbbr = (row.home_team || '').toUpperCase();
        const selAbbr = (row.selected_team || '').toUpperCase();
        const awayId = teamByAbbr.get(awayAbbr);
        const homeId = teamByAbbr.get(homeAbbr);
        const selId = teamByAbbr.get(selAbbr);
        if (!awayId || !homeId) {
          fail(`unknown team abbreviation(s) ${awayAbbr}/${homeAbbr}`);
          continue;
        }
        if (!selId) {
          fail(`unknown selected_team ${JSON.stringify(row.selected_team)}`);
          continue;
        }
        if (selId !== awayId && selId !== homeId) {
          fail(
            `selected_team ${selAbbr} did not play in ${awayAbbr} @ ${homeAbbr}`
          );
          continue;
        }

        const g = await client.query(
          `SELECT g.id, g.lock_at
           FROM games g
           JOIN weeks w ON w.id = g.week_id
           JOIN seasons s ON s.id = w.season_id
           WHERE s.league = 'NFL' AND s.year = $1
             AND w.number = $2
             AND g.away_team_id = $3
             AND g.home_team_id = $4`,
          [seasonYear, weekNumber, awayId, homeId]
        );
        if (g.rows.length === 0) {
          fail(
            `no game found for ${seasonYear} week ${weekNumber} ${awayAbbr} @ ${homeAbbr}`
          );
          continue;
        }
        const game = g.rows[0];

        if (dryRun) {
          imported += 1;
          continue;
        }

        const ins = await client.query(
          `INSERT INTO picks
             (user_id, game_id, selected_team_id, committed_at, lock_reason)
           VALUES ($1, $2, $3, $4, 'historical_import')
           ON CONFLICT (user_id, game_id) DO NOTHING`,
          [userId, game.id, selId, game.lock_at]
        );
        if ((ins.rowCount ?? 0) > 0) imported += 1;
        else skipped += 1;
      }

      if (errors.length > 0) {
        await client.query('ROLLBACK');
        console.error(
          `import-historical-picks: ${errors.length} row(s) failed validation — nothing was written:`
        );
        for (const e of errors) console.error(`  ${e}`);
        process.exit(1);
      }

      if (dryRun) {
        await client.query('ROLLBACK');
        console.log(
          `import-historical-picks: dry run OK — ${rows.length} rows validated, ` +
            `${imported} would import`
        );
      } else {
        await client.query('COMMIT');
        console.log(
          `import-historical-picks: OK — ${imported} imported, ` +
            `${skipped} already existed, ${rows.length} rows total`
        );
      }
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(`import-historical-picks: FAILED: ${err.message}`);
  process.exit(1);
});
