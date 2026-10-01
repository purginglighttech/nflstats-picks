// db/enqueue.mjs
// Operator CLI for the job queue (the operator surface for Phase 2 syncs;
// a sync dashboard UI is a later phase).
//
// Usage:
//   node db/enqueue.mjs ingest-week --season 2026 --week 4 [--provider espn]
//   node db/enqueue.mjs list [--limit 20]
//   node db/enqueue.mjs stale --season 2026 [--max-age-hours 24]
//
// `stale` is the stale-feed alarm surface: it exits non-zero when the current
// week's latest successful `ingest_week` sync is older than --max-age-hours,
// so a cron/monitor can page the operator.
//
// Only node built-ins + the `pg` package.

import pg from 'pg';

function fail(msg) {
  console.error(`enqueue: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 2;
      } else {
        args[key] = true;
        i += 1;
      }
    } else {
      args._.push(a);
      i += 1;
    }
  }
  return args;
}

async function cmdIngestWeek(pool, args) {
  const season = Number(args.season);
  const week = Number(args.week);
  const provider = args.provider || 'espn';
  if (!Number.isInteger(season) || season < 2000) fail('--season must be a year (e.g. 2026)');
  if (!Number.isInteger(week) || week < 1 || week > 22) fail('--week must be 1..22');
  const payload = { type: 'ingest_week', provider, season, week };
  const { rows } = await pool.query(
    `INSERT INTO jobs (payload, status, run_at, max_attempts)
     VALUES ($1, 'queued', now(), 5)
     RETURNING id`,
    [JSON.stringify(payload)]
  );
  console.log(`enqueued ingest_week job ${rows[0].id} (season=${season} week=${week} provider=${provider})`);
}

async function cmdGradeWeek(pool, args) {
  const season = Number(args.season);
  const week = Number(args.week);
  if (!Number.isInteger(season) || season < 2000) fail('--season must be a year (e.g. 2026)');
  if (!Number.isInteger(week) || week < 1 || week > 22) fail('--week must be 1..22');
  const payload = { type: 'grade_week', season, week };
  const { rows } = await pool.query(
    `INSERT INTO jobs (payload, status, run_at, max_attempts)
     VALUES ($1, 'queued', now(), 5)
     RETURNING id`,
    [JSON.stringify(payload)]
  );
  console.log(`enqueued grade_week job ${rows[0].id} (season=${season} week=${week})`);
}

async function cmdList(pool, args) {
  const limit = Math.min(Number(args.limit) || 20, 100);
  const { rows } = await pool.query(
    `SELECT id, status, payload->>'type' AS type,
            payload->>'season' AS season, payload->>'week' AS week,
            attempts, max_attempts, run_at, created_at
     FROM jobs ORDER BY created_at DESC LIMIT $1`,
    [limit]
  );
  for (const r of rows) {
    console.log(
      `${r.id}  ${r.status.padEnd(9)} ${String(r.type).padEnd(12)} ` +
        `season=${r.season || '-'} week=${r.week || '-'} ` +
        `attempts=${r.attempts}/${r.max_attempts} run_at=${r.run_at}`
    );
  }
  if (rows.length === 0) console.log('no jobs');
}

async function cmdStale(pool, args) {
  const season = Number(args.season);
  const maxAgeHours = Number(args['max-age-hours'] || 24);
  if (!Number.isInteger(season)) fail('--season is required (e.g. 2026)');
  const { rows } = await pool.query(
    `SELECT w.number AS week, sr.finished_at, sr.status
     FROM weeks w
     JOIN seasons s ON s.id = w.season_id
     LEFT JOIN LATERAL (
       SELECT finished_at, status
       FROM sync_runs
       WHERE provider = 'espn' AND job_name = 'ingest_week'
         AND week = w.number AND season = s.year
       ORDER BY finished_at DESC NULLS LAST
       LIMIT 1
     ) sr ON true
     WHERE s.league = 'NFL' AND s.year = $1 AND w.is_current`,
    [season]
  );
  if (rows.length === 0) {
    console.log(`stale: no weeks ingested for season ${season}`);
    process.exit(2);
  }
  const cur = rows[0];
  if (!cur.finished_at || cur.status !== 'succeeded') {
    console.log(
      `stale: current week ${cur.week} has no successful sync (last: ${cur.status || 'never'})`
    );
    process.exit(2);
  }
  const ageHours = (Date.now() - new Date(cur.finished_at).getTime()) / 3600_000;
  if (ageHours > maxAgeHours) {
    console.log(
      `stale: current week ${cur.week} last synced ${ageHours.toFixed(1)}h ago ` +
        `(limit ${maxAgeHours}h) at ${cur.finished_at}`
    );
    process.exit(2);
  }
  console.log(
    `ok: current week ${cur.week} synced ${ageHours.toFixed(1)}h ago at ${cur.finished_at}`
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [cmd] = args._;
  if (!process.env.DATABASE_URL) fail('DATABASE_URL is not set');
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    if (cmd === 'ingest-week') await cmdIngestWeek(pool, args);
    else if (cmd === 'grade-week') await cmdGradeWeek(pool, args);
    else if (cmd === 'list') await cmdList(pool, args);
    else if (cmd === 'stale') await cmdStale(pool, args);
    else {
      fail('usage: enqueue.mjs <ingest-week|list|stale|grade-week> [options]');
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => fail(err.message));
