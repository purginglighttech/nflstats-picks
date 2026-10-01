// db/run-migrations.mjs
// Applies pending SQL migrations to the database.
//
// Usage:  node db/run-migrations.mjs
// Env:    DATABASE_URL (required)
//
// Behavior:
//  - Creates schema_migrations (filename, checksum, applied_at) if missing.
//  - Applies each migration in db/migrations/*.sql that has not been recorded,
//    in filename order, each inside its own transaction.
//  - Records filename + sha256 checksum + applied_at per migration.
//  - Re-running is a no-op. Exits non-zero on the first failure (that
//    migration's transaction rolls back; previously applied ones stay).
//
// Only node built-ins + the `pg` package.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('run-migrations: DATABASE_URL is not set');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows: applied } = await client.query(
      'SELECT filename, checksum FROM schema_migrations'
    );
    const appliedByName = new Map(applied.map((r) => [r.filename, r.checksum]));

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('run-migrations: no migration files found');
      return;
    }

    let appliedCount = 0;
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      const checksum = sha256(sql);

      if (appliedByName.has(file)) {
        const recorded = appliedByName.get(file);
        if (recorded !== checksum) {
          console.error(
            `run-migrations: CHECKSUM MISMATCH for ${file} ` +
              `(recorded ${recorded}, current ${checksum}). ` +
              'Applied migrations must not be edited; write a new migration instead.'
          );
          process.exit(1);
        }
        console.log(`run-migrations: ${file} already applied, skipping`);
        continue;
      }

      console.log(`run-migrations: applying ${file} ...`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
          [file, checksum]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      appliedCount += 1;
      console.log(`run-migrations: ${file} applied`);
    }

    console.log(
      appliedCount === 0
        ? 'run-migrations: database is up to date (no-op)'
        : `run-migrations: done, ${appliedCount} migration(s) applied`
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('run-migrations: FAILED:', err.message);
  process.exit(1);
});
