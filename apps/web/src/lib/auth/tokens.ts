/**
 * Token helpers: generation, storage hashing, constant-time comparison.
 *
 * Server-only.
 *
 * Design: session / verification / reset tokens are 32 random bytes,
 * base64url-encoded for transport (cookie value or email-link query param).
 * Only the SHA-256 hash is stored in the database, so a read-only DB leak
 * does not yield usable tokens. Comparisons use `crypto.timingSafeEqual`.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, base64url-encoded (43 chars, URL-safe, no padding). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex digest of the raw token — this is what the DB stores. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of a presented raw token against a stored hash.
 * Returns false (in constant time relative to the hash comparison) on any
 * mismatch, including malformed input.
 */
export function tokensEqual(presentedToken: string, storedHash: string): boolean {
  if (!presentedToken || !storedHash) return false;
  const presentedHash = hashToken(presentedToken);
  const a = Buffer.from(presentedHash, "utf8");
  const b = Buffer.from(storedHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
