/**
 * Shared JSON shape builders for v1 responses.
 *
 * Server-only.
 */
import type { AuthUser } from "../auth/users.js";

export interface ProfileJson {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Public profile shape. The users table has no updated_at tracking for
 * profile edits (profiles.updated_at exists but edits are rare); created_at
 * stands in for updated_at in Phase 1.
 */
export function profileJson(user: AuthUser): ProfileJson {
  return {
    id: user.id,
    email: user.email,
    display_name: user.displayName,
    email_verified: user.emailVerified,
    created_at: user.createdAt,
    updated_at: user.createdAt,
  };
}
