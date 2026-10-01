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
      share: z.number().min(0).max(1),
    }),
  ).length(2),
  total_picks: z.number().int().min(0),
});
export type PickRevealSummary = z.infer<typeof PickRevealSummarySchema>;

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
  /** Locked games with no saved pick: a loss in standings, a "miss" on the ledger. */
  misses: z.number().int().min(0),
  /** W / (W + L); misses count as losses; ties excluded. */
  accuracy: z.number().min(0).max(1),
  rank: z.number().int().min(1),
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
  misses: z.number().int().min(0),
  accuracy: z.number().min(0).max(1),
  completed_picks: z.number().int().min(0),
  rank: z.number().int().min(1),
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
