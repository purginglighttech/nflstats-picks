/**
 * Server-side session management against the `sessions` table
 * (sibling B, 001_core.sql):
 *   sessions(id, user_id, token_hash, created_at, expires_at, last_seen_at, revoked_at)
 *
 * The cookie holds the raw token; only its SHA-256 hash is stored.
 * Sessions rotate after authentication (spec) and refresh on a sliding
 * 30-day window: each validated request bumps `last_seen_at`, and when
 * fewer than 15 days of life remain the expiry extends another 30 days.
 *
 * Server-only.
 */
import { query, queryOne } from "../db.js";
import { SESSION_MAX_AGE_SECONDS } from "./cookies.js";
import { generateToken, hashToken } from "./tokens.js";

export interface SessionRecord {
  id: string;
  userId: string;
}

/** When remaining lifetime drops below this, extend the session. */
const REFRESH_THRESHOLD_SECONDS = 15 * 24 * 60 * 60;

function expiresAtFromNow(): Date {
  return new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
}

export interface CreatedSession extends SessionRecord {
  /** Raw token — the only time it is ever available; set it in the cookie. */
  token: string;
  expiresAt: Date;
}

/** Create a fresh session for a user (used at register/sign-in/reset). */
export async function createSession(userId: string): Promise<CreatedSession> {
  const token = generateToken();
  const expiresAt = expiresAtFromNow();
  const row = await queryOne<{ id: string }>(
    `INSERT INTO sessions (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [userId, hashToken(token), expiresAt.toISOString()],
  );
  if (!row) throw new Error("Failed to create session.");
  return { id: row.id, userId, token, expiresAt };
}

/**
 * Rotate a session after authentication: revoke the old token (when there is
 * one) and issue a new one. The old token stops working immediately.
 */
export async function rotateSession(
  userId: string,
  oldToken: string | null,
): Promise<CreatedSession> {
  if (oldToken) {
    await query(
      `UPDATE sessions SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(oldToken)],
    );
  }
  return createSession(userId);
}

/** Revoke one session by its raw token. */
export async function revokeSession(token: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}

/** Revoke every session of a user (password reset / account lockout). */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  await query(
    `UPDATE sessions SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}

/**
 * Validate a presented session token. Returns the session on success and
 * performs the sliding-refresh bookkeeping; returns null when the token is
 * unknown, expired, or revoked.
 */
export async function validateSessionToken(
  token: string | undefined | null,
): Promise<SessionRecord | null> {
  if (!token) return null;
  const row = await queryOne<{
    id: string;
    user_id: string;
    expires_at: string;
  }>(
    `SELECT id, user_id, expires_at
     FROM sessions
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
  if (!row) return null;

  const expiresAtMs = new Date(row.expires_at).getTime();
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  const remaining = (expiresAtMs - Date.now()) / 1000;
  if (remaining < REFRESH_THRESHOLD_SECONDS) {
    await query(
      `UPDATE sessions
       SET last_seen_at = now(), expires_at = $2
       WHERE id = $1`,
      [row.id, expiresAtFromNow().toISOString()],
    );
  } else {
    await query(`UPDATE sessions SET last_seen_at = now() WHERE id = $1`, [
      row.id,
    ]);
  }
  return { id: row.id, userId: row.user_id };
}
