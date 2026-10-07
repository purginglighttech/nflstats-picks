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

/**
 * Contracts: v1/competition.ts box-score schemas.
 * GET /api/v1/games/[id] -> GameBoxScore.
 */
export interface TeamGameStat {
  team_id: string;
  metric_key: string;
  display_label: string | null;
  display_value: string | null;
  metric_value: number | null;
  unit: string | null;
  category: string | null;
  position: number;
}

export interface PlayerGameStat {
  team_id: string | null;
  player_name: string | null;
  category_key: string;
  category_label: string | null;
  metric_key: string;
  display_label: string | null;
  display_value: string | null;
  metric_value: number | null;
  unit: string | null;
}

export interface GameLeader {
  team_id: string;
  category_key: string;
  category_label: string | null;
  rank: number;
  player_name: string | null;
  display_value: string | null;
  metric_value: number | null;
}

export interface ScoringPeriod {
  team_id: string;
  period_number: number;
  points: number;
}

export interface GameBoxScore {
  game: Game;
  periods: ScoringPeriod[];
  team_stats: TeamGameStat[];
  player_stats: PlayerGameStat[];
  leaders: GameLeader[];
}

/* ------------------------------------------------------------------ */
/* Phase 3: picks, reveal, standings.                                   */
/* Contracts: v1/competition.ts PickSchema / WeekPicksResponseSchema /  */
/* PickRevealSummarySchema / RevealParticipantListResponseSchema /      */
/* WeeklyStandingsResponseSchema / SeasonStandingsResponseSchema.       */
/* ------------------------------------------------------------------ */

/** Contracts: v1/competition.ts PickSchema. */
export interface Pick {
  game_id: string;
  selected_team_id: string;
  saved_at: string;
  revision: number;
  locked: boolean;
}

/** Contracts: v1/competition.ts WeekPicksResponseSchema. */
export interface WeekPicksResponse {
  week_id: string;
  picks: Pick[];
}

/** Contracts: v1/competition.ts OwnPickResponseSchema. */
export interface OwnPickResponse {
  pick: Pick | null;
  locked: boolean;
}

export interface RevealTeamSummary {
  team_id: string;
  pick_count: number;
  /** Share of ALL eligible participants (the two shares may total < 1). */
  share: number;
}

/** Contracts: v1/competition.ts PickRevealSummarySchema. */
export interface PickRevealSummary {
  game_id: string;
  locked: true;
  teams: [RevealTeamSummary, RevealTeamSummary];
  total_picks: number;
  eligible_participants: number;
}

/** Contracts: v1/competition.ts RevealParticipantListResponseSchema. */
export interface RevealParticipantListResponse {
  game_id: string;
  team_id: string;
  participants: Array<{ user_id: string; display_name: string }>;
  total: number;
  next_cursor: string | null;
}

export interface WeeklyStanding {
  week_id: string;
  user_id: string;
  display_name: string;
  wins: number;
  losses: number;
  ties: number;
  misses: number;
  /** Null when W+L is 0 — renders as an em dash, never zero. */
  accuracy: number | null;
  rank: number;
  games_behind: number;
  updated_at: string;
}

/** Contracts: v1/competition.ts WeeklyStandingsResponseSchema. */
export interface WeeklyStandingsResponse {
  week_id: string;
  standings: WeeklyStanding[];
  updated_at: string;
}

export interface SeasonStanding {
  season: number;
  user_id: string;
  display_name: string;
  wins: number;
  losses: number;
  ties: number;
  misses: number;
  accuracy: number | null;
  completed_picks: number;
  rank: number;
  games_behind: number;
  updated_at: string;
}

/** Contracts: v1/competition.ts SeasonStandingsResponseSchema. */
export interface SeasonStandingsResponse {
  season: number;
  standings: SeasonStanding[];
  updated_at: string;
}

/**
 * Contracts: v1/competition.ts HeadToHeadResponseSchema.
 * GET /api/v1/compare -> head-to-head game ledger.
 */
export interface HeadToHeadGame {
  game_id: string;
  week_id: string;
  week_number: number;
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  status: string;
  user_a_pick: string | null;
  user_b_pick: string | null;
  user_a_grade: 'win' | 'loss' | 'tie' | 'pending' | 'void' | null;
  user_b_grade: 'win' | 'loss' | 'tie' | 'pending' | 'void' | null;
  agreed: boolean;
}

export interface HeadToHeadResponse {
  user_a: { user_id: string; display_name: string };
  user_b: { user_id: string; display_name: string };
  week_id: string | null;
  season: number;
  games: HeadToHeadGame[];
  summary: {
    games: number;
    agreed: number;
    disagreed: number;
    user_a_disagreement_wins: number;
    user_b_disagreement_wins: number;
  };
}
