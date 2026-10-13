/**
 * v1 editorial read contracts: news, reports, rankings, team payload tabs.
 *
 * Read shapes only — editorial writes (reviews, approvals, publishing,
 * assessments, imports) are operator endpoints for a later phase.
 * Spec rule honored throughout: no outside opinions presented as analysis;
 * every assessment carries its citation.
 */
import { z } from "zod";
import {
  EntityIdSchema,
  IsoDateTimeSchema,
  NflTeamSchema,
} from "./common.js";

/* ------------------------------------------------------------------ */
/* News                                                                */
/* ------------------------------------------------------------------ */

/** GET /league/news and GET /teams/[id]/news items. Excerpts are plain text. */
export const NewsItemSchema = z.object({
  id: EntityIdSchema,
  team_id: NflTeamSchema.nullable(),
  title: z.string().min(1).max(200),
  excerpt: z.string().min(1).max(2000),
  source_url: z.string().url().max(2048).nullable(),
  source_name: z.string().min(1).max(120).nullable(),
  published_at: IsoDateTimeSchema,
});
export type NewsItem = z.infer<typeof NewsItemSchema>;

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export const ReportStatusSchema = z.enum(["draft", "in_review", "published"]);
export type ReportStatus = z.infer<typeof ReportStatusSchema>;

/** GET /reports/[id] — structured report edition (PDF generated on demand). */
export const ReportEditionSchema = z.object({
  id: EntityIdSchema,
  season: z.number().int().min(2000).max(2100),
  week_number: z.number().int().min(1).max(22).nullable(),
  title: z.string().min(1).max(200),
  status: ReportStatusSchema,
  summary: z.string().min(1),
  methodology_version: z.string().min(1).max(32),
  dataset_revision: z.string().min(1).max(64),
  published_at: IsoDateTimeSchema.nullable(),
});
export type ReportEdition = z.infer<typeof ReportEditionSchema>;

/* ------------------------------------------------------------------ */
/* Rankings — five in-house categories + outlet roundup (Phase 2+)      */
/* ------------------------------------------------------------------ */

export const RankingTypeSchema = z.enum([
  "teams",
  "quarterbacks",
  "offense",
  "defense",
  "special_teams",
  "outlets",
]);
export type RankingType = z.infer<typeof RankingTypeSchema>;

/** One entry of an all-32 ranking edition. */
export const RankingEntrySchema = z.object({
  rank: z.number().int().min(1).max(32),
  team_id: NflTeamSchema,
  /** Composite score; null for outlet roundups that only carry ranks. */
  composite_score: z.number().nullable(),
  /** Component ranks behind the composite (offense/defense/special teams/net point differential). */
  component_ranks: z
    .object({
      offense: z.number().int().min(1).max(32).nullable(),
      defense: z.number().int().min(1).max(32).nullable(),
      special_teams: z.number().int().min(1).max(32).nullable(),
      net_point_differential: z.number().int().min(1).max(32).nullable(),
    })
    .nullable(),
  previous_rank: z.number().int().min(1).max(32).nullable(),
});
export type RankingEntry = z.infer<typeof RankingEntrySchema>;

/** GET /rankings/[type]/current — carries the methodology + dataset revision for traceability. */
export const RankingEditionSchema = z.object({
  ranking_type: RankingTypeSchema,
  season: z.number().int().min(2000).max(2100),
  week_number: z.number().int().min(1).max(22),
  methodology_version: z.string().min(1).max(32),
  dataset_revision: z.string().min(1).max(64),
  published_at: IsoDateTimeSchema,
  entries: z.array(RankingEntrySchema).length(32),
});
export type RankingEdition = z.infer<typeof RankingEditionSchema>;

/* ------------------------------------------------------------------ */
/* Team payload — Home / Season / News / Statements tabs               */
/* ------------------------------------------------------------------ */

/** Reduced stat row: value + league rank (spec: readability via ranks). */
export const ReducedStatSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.number(),
  display: z.string().min(1).max(32),
  league_rank: z.number().int().min(1).max(32).nullable(),
});
export type ReducedStat = z.infer<typeof ReducedStatSchema>;

/** Declared current injury: player, injury, status. */
export const DeclaredInjurySchema = z.object({
  player_name: z.string().min(1).max(120),
  injury: z.string().min(1).max(120),
  status: z.string().min(1).max(64),
  updated_at: IsoDateTimeSchema,
});
export type DeclaredInjury = z.infer<typeof DeclaredInjurySchema>;

/** Cited communication assessment (Statements tab); newest first. */
export const StatementSchema = z.object({
  id: EntityIdSchema,
  team_id: NflTeamSchema,
  source_url: z.string().url().max(2048),
  source_date: z.string().min(1).max(32),
  speaker: z.string().min(1).max(120),
  outlet: z.string().min(1).max(120),
  /** Our accountability-filter analysis of the communication. */
  analysis: z.string().min(1),
  published_at: IsoDateTimeSchema,
});
export type Statement = z.infer<typeof StatementSchema>;

/** One game of the Season tab ledger: pregame probability next to the result. */
export const SeasonLedgerGameSchema = z.object({
  game_id: EntityIdSchema,
  week_number: z.number().int().min(1).max(22),
  opponent_team_id: NflTeamSchema,
  home_game: z.boolean(),
  /** Our published pregame win probability for this team (0..1), null if unpublished. */
  pregame_win_probability: z.number().min(0).max(1).nullable(),
  team_score: z.number().int().min(0).nullable(),
  opponent_score: z.number().int().min(0).nullable(),
  result: z.enum(["win", "loss", "tie", "scheduled"]).nullable(),
});
export type SeasonLedgerGame = z.infer<typeof SeasonLedgerGameSchema>;

/** GET /teams/[id] — Home tab payload. */
export const TeamHomePayloadSchema = z.object({
  team_id: NflTeamSchema,
  record: z.object({
    wins: z.number().int().min(0),
    losses: z.number().int().min(0),
    ties: z.number().int().min(0),
  }),
  stats_offense: z.array(ReducedStatSchema),
  stats_defense: z.array(ReducedStatSchema),
  stats_special_teams: z.array(ReducedStatSchema),
  /** Weekly ranks in the Big Movers / callout style; null until assessed. */
  weekly_rankings: z
    .array(
      z.object({
        ranking_type: RankingTypeSchema,
        rank: z.number().int().min(1).max(32),
        movement: z.number().int().nullable(),
      }),
    )
    .nullable(),
  /** Our read: league position offensively/defensively, development/philosophy analysis. */
  our_read: z.string().min(1).nullable(),
  declared_injuries: z.array(DeclaredInjurySchema).nullable(),
  injury_analysis: z.string().min(1).nullable(),
  /**
   * Sustainability assessment — labeled analysis only, firewalled from the
   * prediction model. Null until assessed ("not yet assessed" state).
   */
  sustainability_assessment: z.string().min(1).nullable(),
});
export type TeamHomePayload = z.infer<typeof TeamHomePayloadSchema>;

/** GET /teams/[id]/season */
export const TeamSeasonPayloadSchema = z.object({
  team_id: NflTeamSchema,
  games: z.array(SeasonLedgerGameSchema),
});
export type TeamSeasonPayload = z.infer<typeof TeamSeasonPayloadSchema>;

/** GET /teams/[id]/news */
export const TeamNewsPayloadSchema = z.object({
  team_id: NflTeamSchema,
  items: z.array(NewsItemSchema),
});
export type TeamNewsPayload = z.infer<typeof TeamNewsPayloadSchema>;

/** GET /teams/[id]/statements — newest first, with the changelog behind it. */
export const TeamStatementsPayloadSchema = z.object({
  team_id: NflTeamSchema,
  statements: z.array(StatementSchema),
  changelog: z.array(
    z.object({
      at: IsoDateTimeSchema,
      summary: z.string().min(1).max(500),
    }),
  ),
});
export type TeamStatementsPayload = z.infer<typeof TeamStatementsPayloadSchema>;

/** Combined team payload shape for clients that fetch all tabs at once. */
export const TeamPayloadSchema = z.object({
  home: TeamHomePayloadSchema,
  season: TeamSeasonPayloadSchema,
  news: TeamNewsPayloadSchema,
  statements: TeamStatementsPayloadSchema,
});
export type TeamPayload = z.infer<typeof TeamPayloadSchema>;

/* ------------------------------------------------------------------ */
/* Wednesday feature (Phase 2+)                                        */
/* ------------------------------------------------------------------ */

export const FeaturePayloadSchema = z.object({
  id: EntityIdSchema,
  season: z.number().int().min(2000).max(2100),
  week_number: z.number().int().min(1).max(22),
  title: z.string().min(1).max(200),
  status: ReportStatusSchema,
  published_at: IsoDateTimeSchema.nullable(),
});
export type FeaturePayload = z.infer<typeof FeaturePayloadSchema>;

/* ------------------------------------------------------------------ */
/* Reports archive + reader (wired to migration 003 tables)            */
/* ------------------------------------------------------------------ */

/** The report_type values of report_editions (migration 003). */
export const ReportTypeSchema = z.enum([
  "teams",
  "quarterbacks",
  "offense",
  "defense",
  "special_teams",
  "outlet_roundup",
  "game_final",
  "news_briefing",
  "personnel",
  "post_week",
  "wednesday_preview",
  "injury_sweep",
  "inactives",
  "pregame_check",
]);
export type ReportType = z.infer<typeof ReportTypeSchema>;

/** Display labels for report types (client-safe). */
export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  teams: "Power Rankings — Teams",
  quarterbacks: "Power Rankings — Quarterbacks",
  offense: "Power Rankings — Offense",
  defense: "Power Rankings — Defense",
  special_teams: "Power Rankings — Special Teams",
  outlet_roundup: "Outlet Rankings Roundup",
  game_final: "Final Game Report",
  news_briefing: "News Briefing",
  personnel: "Personnel Report",
  post_week: "Post-Week Review",
  wednesday_preview: "Wednesday Preview",
  injury_sweep: "Injury Sweep",
  inactives: "Inactives Briefing",
  pregame_check: "Pregame Check",
};

export const ReportContentClassSchema = z.enum([
  "factual",
  "prediction",
  "opinion",
  "mixed",
]);
export type ReportContentClass = z.infer<typeof ReportContentClassSchema>;

/** One published edition in the archive list. */
export const ReportListItemSchema = z.object({
  id: EntityIdSchema,
  report_type: ReportTypeSchema,
  content_class: ReportContentClassSchema,
  title: z.string().min(1).max(300),
  summary: z.string().max(4000).nullable(),
  season: z.number().int().min(2000).max(2100).nullable(),
  week_number: z.number().int().min(1).max(22).nullable(),
  week_label: z.string().max(40).nullable(),
  reporting_period: z.string().max(120).nullable(),
  generated_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type ReportListItem = z.infer<typeof ReportListItemSchema>;

/** GET /reports — every published edition, newest first. */
export const ReportListResponseSchema = z.object({
  reports: z.array(ReportListItemSchema),
});
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;

export const ReportBlockTypeSchema = z.enum([
  "evidence",
  "interpretation",
  "summary",
]);
export type ReportBlockType = z.infer<typeof ReportBlockTypeSchema>;

/** One ordered block of an edition; body is markdown (subset renderer). */
export const ReportEntrySchema = z.object({
  entry_key: z.string().min(1).max(120),
  position: z.number().int().min(0),
  block_type: ReportBlockTypeSchema,
  heading: z.string().max(300).nullable(),
  body: z.string().min(1),
});
export type ReportEntry = z.infer<typeof ReportEntrySchema>;

export const ReportCitationSchema = z.object({
  claim_key: z.string().max(120).nullable(),
  url: z.string().url().max(2048),
  publisher: z.string().max(200).nullable(),
  corroboration_status: z
    .enum(["confirmed_multi_source", "single_source_exception", "not_applicable"])
    .nullable(),
  limitation_note: z.string().max(1000).nullable(),
});
export type ReportCitation = z.infer<typeof ReportCitationSchema>;

/** GET /reports/[id] — one published edition with entries and citations. */
export const ReportDetailResponseSchema = z.object({
  report: ReportListItemSchema.extend({
    revision: z.number().int().min(1),
    methodology_version: z.string().max(32).nullable(),
    dataset_revision: z.string().max(64).nullable(),
    pdf_asset_ref: z.string().max(500).nullable(),
  }),
  entries: z.array(ReportEntrySchema),
  citations: z.array(ReportCitationSchema),
});
export type ReportDetailResponse = z.infer<typeof ReportDetailResponseSchema>;
