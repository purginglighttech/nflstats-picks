/**
 * PostgreSQL access: a process-wide `pg` Pool singleton plus a typed query
 * helper and a transaction helper. No ORM.
 *
 * Server-only: this module must never be imported from client components.
 * It reads DATABASE_URL from the environment (never logged).
 */
import { Pool, type PoolClient } from "pg";

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set.");
    }
    pool = new Pool({
      connectionString,
      // Modest pool: auth + settings traffic only in Phase 1.
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on("error", (err) => {
      // A broken idle client must not take the process down silently.
      console.error("[db] unexpected pool error", (err as Error).message);
    });
  }
  return pool;
}

/**
 * Run a parameterized query and return the typed rows. Always parameterized —
 * callers must never interpolate values into `text`.
 *
 * `DbResult` is deliberately narrower than pg's `QueryResult`: callers get
 * `rows` and `rowCount` without inheriting pg's `QueryResultRow` index-
 * signature constraint on their row types.
 */
export interface DbResult<T> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<DbResult<T>> {
  const res = await getPool().query(text, params as unknown[]);
  return { rows: res.rows as T[], rowCount: res.rowCount };
}

/** Convenience: first row or undefined. */
export async function queryOne<T>(
  text: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | undefined> {
  const res = await query<T>(text, params);
  return res.rows[0];
}

/**
 * Run `fn` inside a transaction. Commits on success, rolls back on throw,
 * and always releases the client.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Rollback failure: the client is released below; nothing more to do.
    }
    throw err;
  } finally {
    client.release();
  }
}

/** True when the error is Postgres "undefined_table" (42P01). */
export function isUndefinedTableError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "42P01"
  );
}

/** True when the error is a unique-violation (23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: string }).code === "23505"
  );
}
