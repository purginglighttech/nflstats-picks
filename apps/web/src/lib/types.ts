/**
 * Client-side wire shapes for /api/v1.
 *
 * These mirror sibling C's `@pickem/contracts` package
 * (app/packages/contracts/src/v1/*.ts) — the single source of truth.
 * When that package is built and added to apps/web's dependencies, these
 * local declarations should be replaced with direct type imports from
 * `@pickem/contracts`. Until then they are kept in sync by hand; any
 * drift is a bug — see the per-type provenance notes.
 */

export type AccentSource = 'team' | 'neutral';
export type Luminance = 'light' | 'dark' | 'system';

/**
 * Contracts: v1/auth.ts AuthMeResponseSchema['user'].
 * GET /api/v1/auth/me -> { user: Me }.
 */
export interface Me {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  created_at: string;
}

/**
 * Contracts: v1/me.ts UserSettingsSchema.
 * GET /api/v1/me/settings. Note: timezone lives here, NOT on the profile.
 */
export interface MemberSettings {
  accent_source: AccentSource;
  luminance: Luminance;
  timezone: string;
  updated_at: string;
}

/** Contracts: v1/me.ts PatchUserSettingsRequestSchema (partial). */
export interface SettingsPatch {
  accent_source?: AccentSource;
  luminance?: Luminance;
  timezone?: string;
}

/**
 * Contracts: v1/me.ts TeamFollowSchema.
 * GET /api/v1/me/team-follows -> { follows: TeamFollow[] }, ordered by
 * rank_position ascending. team_id is the canonical UPPERCASE abbreviation
 * (contracts v1/common.ts NFL_TEAMS, e.g. 'KC'; Washington is 'WAS').
 * The first active entry is the effective favorite.
 */
export interface TeamFollow {
  team_id: string;
  rank_position: number;
  active: boolean;
}

/**
 * Contracts: v1/me.ts PutTeamFollowsRequestSchema.
 * rank_position is derived from array order (first entry = 1); clients
 * must NOT send positions.
 */
export interface TeamFollowOrderUpdate {
  follows: Array<{ team_id: string; active: boolean }>;
}

/**
 * Contracts: v1/me.ts ProfileSchema / PatchProfileRequestSchema.
 * GET /api/v1/me/profile -> Profile. PATCH accepts display_name ONLY —
 * timezone is a settings field.
 */
export interface Profile {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProfilePatch {
  display_name?: string;
}

/**
 * Contracts: v1/competition.ts GameSchema / BallotScheduleResponseSchema.
 * GET /api/v1/weeks/[id]/games -> { week_id, games: Game[] }.
 */
export interface Game {
  id: string;
  season: number;
  week_number: number;
  kickoff_at: string;
  lock_at: string;
  home_team_id: string;
  away_team_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

/**
 * GET /api/v1/weeks/current — ASSUMED minimal shape. The route manifest
 * marks this 501 not_implemented for Phase 1 (no sports data seeded), so
 * no contract shape exists yet; revisit when sibling C defines it.
 */
export interface Week {
  id: string;
  season: number;
  week_number: number;
  label: string;
  status: string;
}
