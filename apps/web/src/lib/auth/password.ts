/**
 * Password hashing with argon2id (spec: memory-hard algorithm).
 *
 * Server-only. Parameters follow the OWASP recommendation for interactive
 * logins: 19 MiB memory, 2 iterations, 1 lane.
 *
 * Account-enumeration protection: `verifyAgainstDummy()` runs a real argon2
 * verify against a fixed dummy hash so sign-in attempts for unknown emails
 * cost the same as real verifications. The dummy hash is generated lazily
 * once per process.
 */
import argon2, { argon2id } from "argon2";

const ARGON_OPTIONS = {
  type: argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { ...ARGON_OPTIONS });
}

export async function verifyPassword(
  hash: string,
  password: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    // Malformed stored hash or verification failure: treat as non-match.
    // (A malformed hash in the DB is an ops problem, not a login success.)
    return false;
  }
}

let dummyHashPromise: Promise<string> | undefined;

/**
 * Verify a password against a process-wide dummy hash. Used when the email
 * has no account so the timing profile matches a real verification.
 */
export async function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHashPromise ??= argon2.hash("dummy-password-for-timing-parity", {
    ...ARGON_OPTIONS,
  });
  const dummy = await dummyHashPromise;
  return verifyPassword(dummy, password);
}
