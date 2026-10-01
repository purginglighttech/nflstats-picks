// db/worker.mjs
// Minimal database-backed queue worker SKELETON (Phase 1).
//
// Usage:  node db/worker.mjs
// Env:    DATABASE_URL (required), WORKER_ID (optional), POLL_MS (optional,
//         default 1000)
//
// Behavior:
//  - Polls the jobs table for due queued jobs (run_at <= now()).
//  - Claims them atomically with SELECT ... FOR UPDATE SKIP LOCKED so
//    multiple workers never take the same job.
//  - Phase 1 handles ONLY the `noop` job type (payload.type === 'noop'):
//    it logs the payload and marks the job done. This proves the queue seam.
//  - Unknown job types are marked failed with a clear error (Phase 2+ adds
//    real handlers by registering them in HANDLERS).
//  - A job that throws is retried until max_attempts, then marked failed with
//    the last error recorded.
//  - Exits cleanly on SIGTERM/SIGINT: stops claiming, waits for the in-flight
//    job to finish, then closes the pool.
//
// Only node built-ins + the `pg` package.

import pg from 'pg';

import { runWeek } from './ingest/run-week.mjs';

const { Pool } = pg;

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const POLL_MS = Number(process.env.POLL_MS || 1000);

if (!process.env.DATABASE_URL) {
  console.error('worker: DATABASE_URL is not set');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Handlers: payload.type -> async (client, job) => void
// Phase 2+ registers real handlers here (grading, notifications, ingestion).
// ---------------------------------------------------------------------------
const HANDLERS = {
  async noop(client, job) {
    console.log(
      `[${WORKER_ID}] noop job ${job.id} payload:`,
      JSON.stringify(job.payload)
    );
  },

  /**
   * Ingest one regular-season week of game data.
   * Payload: { type: 'ingest_week', provider?: 'espn', season: 2026, week: N }
   * Retried by the queue on transient provider failures (max_attempts).
   */
  async ingest_week(client, job) {
    const p = job.payload || {};
    const season = Number(p.season);
    const week = Number(p.week);
    if (!Number.isInteger(season) || !Number.isInteger(week) || week < 1) {
      throw new Error(
        `ingest_week: invalid payload ${JSON.stringify({ season: p.season, week: p.week })}`
      );
    }
    const result = await runWeek({ season, week, provider: p.provider || 'espn' });
    console.log(
      `[${WORKER_ID}] ingest_week season=${season} week=${week}: ` +
        `${result.gamesImported} games, ${result.recordsProcessed} records, ` +
        `${result.quarantined} quarantined, digest=${result.digest.digest}`
    );
  },
};

let shuttingDown = false;
let inFlight = false;

async function claimJob(client) {
  // Atomic claim: the first due queued job, skipped if another worker holds it.
  const { rows } = await client.query(
    `
    UPDATE jobs
    SET status = 'running',
        locked_by = $1,
        locked_at = now(),
        attempts = attempts + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE status = 'queued' AND run_at <= now()
      ORDER BY run_at, created_at
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
    `,
    [WORKER_ID]
  );
  return rows[0] || null;
}

async function markDone(client, job) {
  await client.query(
    `UPDATE jobs SET status = 'done', locked_by = NULL, updated_at = now()
     WHERE id = $1`,
    [job.id]
  );
}

async function markFailed(client, job, error) {
  const message = error instanceof Error ? error.message : String(error);
  await client.query(
    `UPDATE jobs
     SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
         run_at = CASE WHEN attempts >= max_attempts THEN run_at ELSE now() + interval '30 seconds' END,
         locked_by = NULL,
         last_error = $2,
         updated_at = now()
     WHERE id = $1`,
    [job.id, message]
  );
}

async function processOne() {
  if (shuttingDown || inFlight) return;
  inFlight = true;
  const client = await pool.connect();
  try {
    const job = await claimJob(client);
    if (!job) return;

    const type = job.payload && job.payload.type;
    const handler = HANDLERS[type];
    console.log(
      `[${WORKER_ID}] claimed job ${job.id} type=${type || '<missing>'} attempt=${job.attempts}`
    );

    try {
      if (!handler) {
        throw new Error(`no handler registered for job type '${type || '<missing>'}'`);
      }
      await handler(client, job);
      await markDone(client, job);
      console.log(`[${WORKER_ID}] job ${job.id} done`);
    } catch (err) {
      console.error(`[${WORKER_ID}] job ${job.id} error:`, err.message);
      await markFailed(client, job, err);
      console.log(
        `[${WORKER_ID}] job ${job.id} ` +
          (job.attempts >= job.max_attempts ? 'failed permanently' : 'requeued for retry')
      );
    }
  } finally {
    client.release();
    inFlight = false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[${WORKER_ID}] received ${signal}, draining...`);
  while (inFlight) {
    await sleep(100);
  }
  await pool.end();
  console.log(`[${WORKER_ID}] exited cleanly`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[${WORKER_ID}] starting (poll every ${POLL_MS}ms)`);
(async () => {
  while (!shuttingDown) {
    try {
      await processOne();
    } catch (err) {
      console.error(`[${WORKER_ID}] poll error:`, err.message);
    }
    await sleep(POLL_MS);
  }
})();
