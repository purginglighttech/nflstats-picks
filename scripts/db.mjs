#!/usr/bin/env node
/**
 * Local dev database control for the NFL pick'em app.
 *
 * Uses embedded-postgres to run a real PostgreSQL cluster on the dev machine —
 * no system Postgres or Docker required.
 *
 *   npm run db:start   Launch the cluster in the background (idempotent).
 *   npm run db:stop    Shut the cluster down (idempotent).
 *   npm run db:reset   Drop + recreate the public schema (server left running).
 *   node scripts/db.mjs url  Print the default DATABASE_URL.
 *
 * Connection details (also in .env.example):
 *   host 127.0.0.1, port 54329, user postgres, password postgres,
 *   database pickem_dev, data dir ./.pgdata-dev (gitignored).
 *
 * Everything is overridable through DATABASE_URL in the environment; sibling
 * workstreams (migrations, seeds, worker) read DATABASE_URL themselves.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Overridable: this sandbox runs as root on an overlayfs where chown(2) is
// blocked, so local verification uses PICKEM_DB_DATADIR=/var/lib/pickem/…
// On a normal dev machine the default ./.pgdata-dev just works.
const DATA_DIR = path.resolve(process.env.PICKEM_DB_DATADIR ?? path.join(ROOT, ".pgdata-dev"));
const POSTMASTER_PID = path.join(DATA_DIR, "postmaster.pid");
const PORT = Number(process.env.PICKEM_DB_PORT ?? 54329);
const USER = "postgres";
const PASSWORD = "postgres";
const DB_NAME = "pickem_dev";
const DAEMON_ENV = "PICKEM_DB_DAEMON";
const AS_POSTGRES_ENV = "PICKEM_DB_AS_POSTGRES";

const DEFAULT_DATABASE_URL = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DB_NAME}`;

const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

// PostgreSQL refuses to run as root, so when this script itself runs as root
// (containers, this sandbox) it re-executes as the unprivileged `postgres`
// system user instead of asking embedded-postgres to manage users (its
// createPostgresUser path needs chown(2), which is blocked here).
if (IS_ROOT && process.env[AS_POSTGRES_ENV] !== "1") {
  const idRes = spawnSync("id", ["postgres"], { stdio: "ignore" });
  if (idRes.status !== 0) {
    const addRes = spawnSync("useradd", ["-r", "-s", "/usr/sbin/nologin", "postgres"], {
      stdio: "inherit",
    });
    if (addRes.status !== 0) {
      console.error(
        "Could not create the postgres system user; refusing to run PostgreSQL as root.",
      );
      process.exit(1);
    }
  }
  const res = spawnSync(
    "runuser",
    [
      "-u",
      "postgres",
      "--",
      process.execPath,
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
    ],
    { stdio: "inherit", env: { ...process.env, [AS_POSTGRES_ENV]: "1" } },
  );
  process.exit(res.status ?? 1);
}

function makePg() {
  return new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: USER,
    password: PASSWORD,
    port: PORT,
    persistent: true,
    onLog: () => {},
  });
}

async function readPostmasterPid() {
  try {
    const contents = await readFile(POSTMASTER_PID, "utf8");
    const pid = Number(contents.split("\n")[0].trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isRunning() {
  const pid = await readPostmasterPid();
  return pid !== null && pidAlive(pid);
}

async function initialiseIfNeeded(pg) {
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    console.log(`Initialising new Postgres cluster in ${DATA_DIR} …`);
    await pg.initialise();
  }
}

async function ensureDatabase(pg) {
  try {
    await pg.createDatabase(DB_NAME);
    console.log(`Created database "${DB_NAME}".`);
  } catch (err) {
    if (!String(err?.message ?? err).includes("already exists")) throw err;
  }
}

async function waitForRunning(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isRunning()) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function waitForStopped(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isRunning())) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Foreground daemon: owns the postgres child process and shuts it down cleanly. */
async function runDaemon() {
  const pg = makePg();
  await initialiseIfNeeded(pg);
  await pg.start();
  await ensureDatabase(pg);
  console.log(`PostgreSQL ready: ${DEFAULT_DATABASE_URL}`);

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, stopping PostgreSQL …`);
    try {
      await pg.stop();
    } catch {
      /* best effort */
    }
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // If the postmaster dies out from under us (e.g. `db:stop` from another
  // process), exit so we don't linger as a zombie daemon.
  const heartbeat = setInterval(async () => {
    if (!(await isRunning())) {
      clearInterval(heartbeat);
      process.exit(0);
    }
  }, 2000);

  await new Promise(() => {});
}

async function ensureDaemonUp() {
  if (await isRunning()) return;
  const pg = makePg();
  await initialiseIfNeeded(pg); // downloads/init happens here, in the foreground
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "start"], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, [DAEMON_ENV]: "1" },
  });
  child.unref();
  if (!(await waitForRunning())) {
    throw new Error("Timed out waiting for the PostgreSQL daemon to become ready.");
  }
}

async function cmdStart() {
  if (process.env[DAEMON_ENV] === "1") {
    await runDaemon();
    return;
  }
  if (await isRunning()) {
    console.log(`PostgreSQL is already running (${DEFAULT_DATABASE_URL}).`);
    return;
  }
  await ensureDaemonUp();
  console.log(`PostgreSQL is running in the background (${DEFAULT_DATABASE_URL}).`);
  console.log("Stop it with: npm run db:stop");
}

async function cmdStop() {
  const pid = await readPostmasterPid();
  if (pid === null || !pidAlive(pid)) {
    console.log("PostgreSQL is not running.");
    return;
  }
  // SIGINT on the postmaster = fast shutdown, same as embedded-postgres stop().
  try {
    process.kill(pid, "SIGINT");
  } catch (err) {
    if (err?.code !== "ESRCH") throw err;
  }
  if (await waitForStopped()) {
    console.log("PostgreSQL stopped.");
  } else {
    console.error("Timed out waiting for PostgreSQL to stop; it may still be running.");
    process.exitCode = 1;
  }
}

async function cmdReset() {
  await ensureDaemonUp();
  const pg = makePg(); // only used for its pg-client factory; no start needed
  const client = pg.getPgClient(DB_NAME, "127.0.0.1");
  await client.connect();
  try {
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO postgres");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    await client.end();
  }
  console.log(`Dropped and recreated the public schema in database "${DB_NAME}".`);
}

const [command] = process.argv.slice(2);
try {
  switch (command) {
    case "start":
      await cmdStart();
      break;
    case "stop":
      await cmdStop();
      break;
    case "reset":
      await cmdReset();
      break;
    case "url":
      console.log(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
      break;
    default:
      console.error("Usage: node scripts/db.mjs <start|stop|reset|url>");
      process.exitCode = 1;
  }
} catch (err) {
  console.error(`db ${command ?? ""} failed:`, err?.message ?? err);
  process.exitCode = 1;
}
