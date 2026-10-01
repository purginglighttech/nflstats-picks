/**
 * Identity store against sibling B's tables (001_core.sql):
 *   users(id, email citext UNIQUE, password_hash, email_verified_at, created_at, updated_at)
 *   profiles(user_id PK -> users, display_name UNIQUE, created_at, updated_at)
 *   email_verification_tokens(id, user_id, token_hash UNIQUE, expires_at, consumed_at, created_at)
 *   password_reset_tokens(id, user_id, token_hash UNIQUE, expires_at, consumed_at, created_at)
 *
 * Email is stored via citext so lookups are case-insensitive; the contracts
 * layer already lowercases on the wire.
 *
 * Server-only. Never select password_hash except where verification needs it.
 */
import {
  isUniqueViolation,
  query,
  queryOne,
  withTransaction,
} from "../db.js";
import { generateToken, hashToken, tokensEqual } from "./tokens.js";

export interface AuthUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  emailVerified: boolean;
  createdAt: string;
}

const USER_COLUMNS = `
  SELECT u.id, u.email, u.password_hash, u.email_verified_at, u.created_at,
         p.display_name
  FROM users u
  JOIN profiles p ON p.user_id = u.id
`;

/** Raw user+profile row from sibling B's users/profiles tables. */
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  /** timestamptz arrives as a Date via node-postgres; text in some paths. */
  created_at: string | Date;
  display_name: string;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    emailVerified: row.email_verified_at !== null,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
  };
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const row = await queryOne<UserRow>(
    `${USER_COLUMNS} WHERE u.email = $1`,
    [email],
  );
  return row ? toAuthUser(row) : null;
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const row = await queryOne<UserRow>(`${USER_COLUMNS} WHERE u.id = $1`, [id]);
  return row ? toAuthUser(row) : null;
}

/** Thrown when the requested display name is already taken. */
export class DisplayNameTakenError extends Error {
  constructor() {
    super("That display name is already taken.");
    this.name = "DisplayNameTakenError";
  }
}

/**
 * Create a user + profile atomically. A taken display name raises
 * DisplayNameTakenError (a usability signal, not an email-enumeration leak);
 * a taken email raises the caller's uniform-success path — callers should
 * check existence first and never surface which case occurred.
 */
export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<AuthUser> {
  return withTransaction(async (client) => {
    const userRow = (
      await client.query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, password_hash, email_verified_at, created_at`,
        [input.email, input.passwordHash],
      )
    ).rows[0] as UserRow;

    try {
      const profileRow = (
        await client.query(
          `INSERT INTO profiles (user_id, display_name)
           VALUES ($1, $2)
           RETURNING display_name`,
          [userRow.id, input.displayName],
        )
      ).rows[0] as { display_name: string };
      return toAuthUser({ ...userRow, display_name: profileRow.display_name });
    } catch (err) {
      if (
        isUniqueViolation(err) &&
        (err as { constraint?: string }).constraint === "profiles_display_name_key"
      ) {
        throw new DisplayNameTakenError();
      }
      throw err;
    }
  });
}

export async function updateDisplayName(
  userId: string,
  displayName: string,
): Promise<void> {
  try {
    await query(`UPDATE profiles SET display_name = $2 WHERE user_id = $1`, [
      userId,
      displayName,
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) throw new DisplayNameTakenError();
    throw err;
  }
}

export async function markEmailVerified(userId: string): Promise<void> {
  await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
     WHERE id = $1`,
    [userId],
  );
}

/* ------------------------------------------------------------------ */
/* Verification + reset tokens (24h / 1h expiry, single use)            */
/* ------------------------------------------------------------------ */

export interface IssuedToken {
  /** Raw token — embed in the email link; never store. */
  raw: string;
  expiresAt: Date;
}

async function issueToken(
  table: "email_verification_tokens" | "password_reset_tokens",
  userId: string,
  ttlMs: number,
): Promise<IssuedToken> {
  const raw = generateToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await withTransaction(async (client) => {
    // One live token per user per purpose: retire earlier pending ones.
    await client.query(
      `DELETE FROM ${table}
       WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId],
    );
    await client.query(
      `INSERT INTO ${table} (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, hashToken(raw), expiresAt.toISOString()],
    );
  });
  return { raw, expiresAt };
}

export function issueVerificationToken(userId: string): Promise<IssuedToken> {
  return issueToken("email_verification_tokens", userId, 24 * 60 * 60 * 1000);
}

export function issuePasswordResetToken(userId: string): Promise<IssuedToken> {
  return issueToken("password_reset_tokens", userId, 60 * 60 * 1000);
}

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
}

async function loadLiveToken(
  table: "email_verification_tokens" | "password_reset_tokens",
  raw: string,
): Promise<TokenRow | null> {
  const row = await queryOne<TokenRow>(
    `SELECT id, user_id, token_hash, expires_at
     FROM ${table}
     WHERE token_hash = $1 AND consumed_at IS NULL`,
    [hashToken(raw)],
  );
  if (!row) return null;
  // Constant-time confirmation of the presented token (defense in depth;
  // the indexed hash lookup already selected the row).
  if (!tokensEqual(raw, row.token_hash)) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

/**
 * Consume a verification token: single-use, 24h expiry. Marks the user's
 * email verified. Returns the user id, or null when the token is unknown,
 * expired, or already used.
 */
export async function consumeVerificationToken(
  raw: string,
): Promise<string | null> {
  const row = await loadLiveToken("email_verification_tokens", raw);
  if (!row) return null;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE email_verification_tokens SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now())
       WHERE id = $1`,
      [row.user_id],
    );
  });
  return row.user_id;
}

/**
 * Consume a reset token and set the new password hash atomically: single-use,
 * 1h expiry. Returns the user id, or null when the token is invalid.
 */
export async function consumeResetToken(
  raw: string,
  newPasswordHash: string,
): Promise<string | null> {
  const row = await loadLiveToken("password_reset_tokens", raw);
  if (!row) return null;
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
      [row.user_id, newPasswordHash],
    );
  });
  return row.user_id;
}
