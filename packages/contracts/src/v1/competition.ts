/**
 * v1 competition read contracts: weeks, games, picks, standings, comparison.
 *
 * Shapes only — scoring, locking, and reveal logic are server-owned and land
 * in Phase 3+. Phase-1 endpoints return empty shapes or 501 not_implemented
 * markers; these types define what the real payloads will look like.
 */
import { z } from "zod";
import {
  DisplayNameSchema,
  EmailSchema,
} from "./auth.js";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NflTeamSchema,
} from "./common.js";

/* ------------------------------------------------------------------ */
/* Weeks and games                                                     */
/* ------------------------------------------------------------------ */

export const WeekStatusSchema = z.enum(["upcoming", "current", "final"]);
export type WeekStatus = z.infer<typeof WeekStatusSchema>;

export const WeekSchema = z.object({
  id: EntityIdSchema,
  season: z.number().int().min(2000).max(2100),
  week_number: z.number().int().min(1).max(22),
  label: z.string().min(1).max(32),
  status: WeekStatusSchema,
  starts_at: IsoDateTimeSchema,
  ends_at: IsoDateTimeSchema,
});
export type Week = z.infer<typeof WeekSchema>;

/** GET /api/v1/weeks/current */
export const CurrentWeekResponseSchema = z.object({
  week: WeekSchema,
});
export type CurrentWeekResponse = z.infer<typeof CurrentWeekResponseSchema>;

export const GameStatusSchema = z.enum(["scheduled", "in_progress", "final"]);
export type GameStatus = z.infer<typeof GameStatusSchema>;

export const GameSchema = z.object({
  id: EntityIdSchema,
  season: z.number().int().min(2000).max(2100),
  week_number: z.number().int().min(1).max(22),
  kickoff_at: IsoDateTimeSchema,
  /** Server commit deadline: five minutes before kickoff per spec. */
  lock_at: IsoDateTimeSchema,
  home_team_id: NflTeamSchema,
  away_team_id: NflTeamSchema,
  status: GameStatusSchema,
  home_score: z.number().int().min(0).nullable(),
  away_score: z.number().int().min(0).nullable(),
});
export type Game = z.infer<typeof GameSchema>;

/** GET /api/v1/weeks/[id]/games — the ballot schedule. */
export const BallotScheduleResponseSchema = z.object({
  week_id: EntityIdSchema,
  games: z.array(GameSchema),
});
export type BallotScheduleResponse = z.infer<typeof BallotScheduleResponseSchema>;

/** GET /api/v1/weeks — every ingested week of the latest season, by week number. */
export const WeeksListResponseSchema = z.object({
  weeks: z.array(WeekSchema),
});
export type WeeksListResponse = z.infer<typeof WeeksListResponseSchema>;

/* ------------------------------------------------------------------ */
/* Box scores                                                          */
/* ------------------------------------------------------------------ */

/**
 * One normalized team-game metric. display_value is the provider's verbatim
 * display string and the display source of truth (Phase 2 decision);
 * metric_value is the parsed numeric beside it. position preserves the
 * provider's row order within the game.
 */
export const TeamGameStatSchema = z.object({
  team_id: NflTeamSchema,
  metric_key: z.string(),
  display_label: z.string().nullable(),
  display_value: z.string().nullable(),
  metric_value: z.number().nullable(),
  unit: z.string().nullable(),
  category: z.string().nullable(),
  position: z.number().int(),
});
export type TeamGameStat = z.infer<typeof TeamGameStatSchema>;

/**
 * One normalized player-game metric. display_value carries the provider's
 * verbatim raw string (raw_value); metric_value the parsed numeric.
 * team_id is null when the row predates team attribution (migration 010)
 * and the player was not among the game's recorded leaders.
 */
export const PlayerGameStatSchema = z.object({
  team_id: NflTeamSchema.nullable(),
  player_name: z.string().nullable(),
  category_key: z.string(),
  category_label: z.string().nullable(),
  metric_key: z.string(),
  display_label: z.string().nullable(),
  display_value: z.string().nullable(),
  metric_value: z.number().nullable(),
  unit: z.string().nullable(),
});
export type PlayerGameStat = z.infer<typeof PlayerGameStatSchema>;

/** A per-game category leader (rank 1..n within team + category). */
export const GameLeaderSchema = z.object({
  team_id: NflTeamSchema,
  category_key: z.string(),
  category_label: z.string().nullable(),
  rank: z.number().int().min(1),
  player_name: z.string().nullable(),
  display_value: z.string().nullable(),
  metric_value: z.number().nullable(),
});
export type GameLeader = z.infer<typeof GameLeaderSchema>;

/** Points by scoring period (quarters, then overtime). */
export const ScoringPeriodSchema = z.object({
  team_id: NflTeamSchema,
  period_number: z.number().int().min(1),
  points: z.number().int().min(0),
});
export type ScoringPeriod = z.infer<typeof ScoringPeriodSchema>;

/**
 * GET /api/v1/games/[id] — the canonical game page payload. One URL serves
 * all three life phases (scheduled preview, in-progress, final report card);
 * the box-score sections populate as the ingest pipeline delivers them.
 */
export const GameBoxScoreResponseSchema = z.object({
  game: GameSchema,
  periods: z.array(ScoringPeriodSchema),
  team_stats: z.array(TeamGameStatSchema),
  player_stats: z.array(PlayerGameStatSchema),
  leaders: z.array(GameLeaderSchema),
});
export type GameBoxScoreResponse = z.infer<typeof GameBoxScoreResponseSchema>;

/* ------------------------------------------------------------------ */
/* Picks                                                               */
/* ------------------------------------------------------------------ */

/** A member's own saved selection for one game (owner-only pre-lock). */
export const PickSchema = z.object({
  game_id: EntityIdSchema,
  selected_team_id: NflTeamSchema,
  saved_at: IsoDateTimeSchema,
  /** Append-only revision counter; revisions are visible to operators. */
  revision: z.number().int().min(1),
  locked: z.boolean(),
});
export type Pick = z.infer<typeof PickSchema>;

/**
 * GET /api/v1/weeks/[id]/picks — the authenticated member's own saved picks
 * for every game of the week. Owner-only; never another participant's picks.
 */
export const WeekPicksResponseSchema = z.object({
  week_id: EntityIdSchema,
  picks: z.array(PickSchema),
});
export type WeekPicksResponse = z.infer<typeof WeekPicksResponseSchema>;

/**
 * PUT /api/v1/games/[id]/pick — save or revise a pick.
 * Per the request path for a pick: game_id comes from the route,
 * selected_team_id and an idempotency key come from the client.
 */
export const SavePickRequestSchema = z.object({
  selected_team_id: NflTeamSchema,
  idempotency_key: z.string().min(8).max(128),
});
export type SavePickRequest = z.infer<typeof SavePickRequestSchema>;

export const SavePickParamsSchema = z.object({
  id: EntityIdSchema,
});
export type SavePickParams = z.infer<typeof SavePickParamsSchema>;

export const SavePickResponseSchema = z.object({
  pick: PickSchema,
});
export type SavePickResponse = z.infer<typeof SavePickResponseSchema>;

/** GET /api/v1/games/[id]/picks — own pick pre-lock; post-lock summary. */
export const OwnPickResponseSchema = z.object({
  pick: PickSchema.nullable(),
  locked: z.boolean(),
});
export type OwnPickResponse = z.infer<typeof OwnPickResponseSchema>;

/** Post-lock reveal: two team buttons with counts + share percentages. */
export const PickRevealSummarySchema = z.object({
  game_id: EntityIdSchema,
  locked: z.literal(true),
  teams: z.array(
    z.object({
      team_id: NflTeamSchema,
      pick_count: z.number().int().min(0),
      /** Share of ALL eligible participants (spec: the two shares may total < 1). */
      share: z.number().min(0).max(1),
    }),
  ).length(2),
  total_picks: z.number().int().min(0),
  /**
   * Explicit denominator (spec: "12 of 18 participants picked"). Eligible =
   * active global-pool members whose membership predates the game's lock_at.
   */
  eligible_participants: z.number().int().min(0),
});
export type PickRevealSummary = z.infer<typeof PickRevealSummarySchema>;

/** One revealed participant on a post-lock team-detail list. */
export const RevealParticipantSchema = z.object({
  user_id: EntityIdSchema,
  display_name: DisplayNameSchema,
});
export type RevealParticipant = z.infer<typeof RevealParticipantSchema>;

/**
 * GET /api/v1/games/[id]/picks?team_id={team} — post-lock participant list
 * for one team. Server-side pagination; the list is complete across pages.
 */
export const RevealParticipantListResponseSchema = z.object({
  game_id: EntityIdSchema,
  team_id: NflTeamSchema,
  participants: z.array(RevealParticipantSchema),
  total: z.number().int().min(0),
  /** Opaque cursor for the next page; absent when the list is complete. */
  next_cursor: z.string().nullable(),
});
export type RevealParticipantListResponse = z.infer<typeof RevealParticipantListResponseSchema>;

/* ------------------------------------------------------------------ */
/* Standings (spec decision #4: most correct, then accuracy, then        */
/* most completed eligible picks, then shared rank)                    */
/* ------------------------------------------------------------------ */

export const WeeklyStandingSchema = z.object({
  week_id: EntityIdSchema,
  user_id: EntityIdSchema,
  display_name: DisplayNameSchema,
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  ties: z.number().int().min(0),
  /** Locked games with no saved pick: a loss in standings, a "miss" on the ledger. */
  misses: z.number().int().min(0),
  /**
   * W / (W + L); misses count as losses; ties excluded. Null when W + L is
   * zero — renders as an em dash, never as zero (spec).
   */
  accuracy: z.number().min(0).max(1).nullable(),
  /**
   * Spec decision #4 rank order: most correct picks, then accuracy, then
   * most completed eligible picks, then shared rank. Standard competition
   * ranking: tied participants share the rank (1, 2, 2, 4).
   */
  rank: z.number().int().min(1),
  /** Leader's correct-pick total minus this participant's (never fractional). */
  games_behind: z.number().int().min(0),
  updated_at: IsoDateTimeSchema,
});
export type WeeklyStanding = z.infer<typeof WeeklyStandingSchema>;

/** GET /api/v1/weeks/[id]/standings */
export const WeeklyStandingsResponseSchema = z.object({
  week_id: EntityIdSchema,
  standings: z.array(WeeklyStandingSchema),
  updated_at: IsoDateTimeSchema,
});
export type WeeklyStandingsResponse = z.infer<typeof WeeklyStandingsResponseSchema>;

export const SeasonStandingSchema = z.object({
  season: z.number().int().min(2000).max(2100),
  user_id: EntityIdSchema,
  display_name: DisplayNameSchema,
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  ties: z.number().int().min(0),
  misses: z.number().int().min(0),
  /** W / (W + L); misses count as losses; ties excluded; null renders as —. */
  accuracy: z.number().min(0).max(1).nullable(),
  /** Graded, non-void outcomes (wins + losses + ties): tie-break #3. */
  completed_picks: z.number().int().min(0),
  rank: z.number().int().min(1),
  games_behind: z.number().int().min(0),
  updated_at: IsoDateTimeSchema,
});
export type SeasonStanding = z.infer<typeof SeasonStandingSchema>;

/** GET /api/v1/seasons/[id]/standings (Phase 2+) */
export const SeasonStandingsResponseSchema = z.object({
  season: z.number().int().min(2000).max(2100),
  standings: z.array(SeasonStandingSchema),
  updated_at: IsoDateTimeSchema,
});
export type SeasonStandingsResponse = z.infer<typeof SeasonStandingsResponseSchema>;

/* ------------------------------------------------------------------ */
/* Comparison ledger (GET /api/v1/compare — Phase 2+)                  */
/* ------------------------------------------------------------------ */

export const ComparisonLedgerSchema = z.object({
  user_a: z.object({
    user_id: EntityIdSchema,
    display_name: DisplayNameSchema,
    email: EmailSchema.optional(),
  }),
  user_b: z.object({
    user_id: EntityIdSchema,
    display_name: DisplayNameSchema,
  }),
  head_to_head: z.object({
    a_wins: z.number().int().min(0),
    b_wins: z.number().int().min(0),
    ties: z.number().int().min(0),
  }),
  weekly: z.array(
    z.object({
      week_id: EntityIdSchema,
      week_number: z.number().int().min(1),
      a_wins: z.number().int().min(0),
      b_wins: z.number().int().min(0),
      tied: z.boolean(),
    }),
  ),
});
export type ComparisonLedger = z.infer<typeof ComparisonLedgerSchema>;

export const CompareQuerySchema = z.object({
  with_user_id: EntityIdSchema,
});
export type CompareQuery = z.infer<typeof CompareQuerySchema>;
