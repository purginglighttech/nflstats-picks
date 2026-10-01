/**
 * Game-data read path (Phase 2): weeks and games from the ingested sports
 * data, mapped to the v1 competition contracts in @pickem/contracts.
 *
 * Status mapping (DB -> contract), documented here because it is a
 * product-visible semantic, not just a cast:
 *   scheduled  -> scheduled
 *   live       -> in_progress
 *   final      -> final
 *   postponed  -> scheduled (not yet played; no result to report)
 *   cancelled  -> scheduled (no result to report)
 *
 * Week windows: starts_at is the earliest kickoff of the week, ends_at the
 * latest kickoff plus three hours (a typical game window). These are
 * derived approximations, not provider facts.
 *
 * Server-only: imports the pg pool via @/lib/db.
 */
import { v1 } from "@pickem/contracts";
import { query, queryOne } from "@/lib/db";

type GameStatus = v1.GameStatus;
type WeekStatus = v1.WeekStatus;

const GAME_STATUS_MAP: Record<string, GameStatus> = {
  scheduled: "scheduled",
  live: "in_progress",
  final: "final",
  postponed: "scheduled",
  cancelled: "scheduled",
};

interface WeekRow {
  id: string;
  season: number;
  week_number: number;
  label: string;
  is_current: boolean;
  starts_at: Date | null;
  ends_at: Date | null;
  game_count: number;
  final_count: number;
}

interface GameRow {
  id: string;
  season: number;
  week_number: number;
  kickoff_at: Date;
  lock_at: Date;
  home_team: string;
  away_team: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
}

const WEEK_SELECT = `
  SELECT w.id,
         s.year AS season,
         w.number AS week_number,
         w.label,
         w.is_current,
         MIN(g.scheduled_at) AS starts_at,
         MAX(g.scheduled_at) AS ends_at,
         COUNT(g.id)::int AS game_count,
         COUNT(*) FILTER (WHERE g.status = 'final')::int AS final_count
  FROM weeks w
  JOIN seasons s ON s.id = w.season_id
  LEFT JOIN games g ON g.week_id = w.id
`;

function toWeekStatus(row: WeekRow): WeekStatus {
  if (row.is_current) return "current";
  if (row.game_count > 0 && row.final_count === row.game_count) return "final";
  return "upcoming";
}

function toWeek(row: WeekRow): v1.Week {
  const startsAt = row.starts_at ?? new Date(0);
  const endsAt = row.ends_at
    ? new Date(row.ends_at.getTime() + 3 * 3600_000)
    : new Date(0);
  return {
    id: row.id,
    season: row.season,
    week_number: row.week_number,
    label: row.label,
    status: toWeekStatus(row),
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
  };
}

function toGame(row: GameRow): v1.Game {
  const status = GAME_STATUS_MAP[row.status];
  if (!status) {
    throw new Error(`games: unmapped game status ${JSON.stringify(row.status)}`);
  }
  return {
    id: row.id,
    season: row.season,
    week_number: row.week_number,
    kickoff_at: row.kickoff_at.toISOString(),
    lock_at: row.lock_at.toISOString(),
    home_team_id: row.home_team as v1.NflTeam,
    away_team_id: row.away_team as v1.NflTeam,
    status,
    home_score: row.home_score,
    away_score: row.away_score,
  };
}

const GAME_SELECT = `
  SELECT g.id,
         s.year AS season,
         w.number AS week_number,
         g.scheduled_at AS kickoff_at,
         g.lock_at,
         ht.abbreviation AS home_team,
         at.abbreviation AS away_team,
         g.status,
         r.home_score,
         r.away_score
  FROM games g
  JOIN weeks w ON w.id = g.week_id
  JOIN seasons s ON s.id = w.season_id
  JOIN teams ht ON ht.id = g.home_team_id
  JOIN teams at ON at.id = g.away_team_id
  LEFT JOIN game_result_revisions r ON r.id = g.result_revision_id
`;

/** The week the product orients on (the ingest pipeline's current-week pointer). */
export async function getCurrentWeek(): Promise<v1.Week | null> {
  const row = await queryOne<WeekRow>(
    `${WEEK_SELECT} WHERE w.is_current GROUP BY w.id, s.year, w.number, w.label, w.is_current`,
  );
  return row ? toWeek(row) : null;
}

/** Latest ingested season year (the season week numbers resolve against). */
export async function getLatestSeasonYear(): Promise<number | null> {
  const row = await queryOne<{ year: number }>(
    `SELECT year FROM seasons WHERE league = 'NFL' ORDER BY year DESC LIMIT 1`,
  );
  return row ? row.year : null;
}

/**
 * Resolve a week by UUID or by week number within the latest season.
 * Returns null when nothing matches.
 */
export async function getWeekByRef(ref: string): Promise<v1.Week | null> {
  let row: WeekRow | undefined;
  if (/^\d{1,2}$/.test(ref)) {
    const weekNumber = Number(ref);
    row = await queryOne<WeekRow>(
      `${WEEK_SELECT}
       WHERE s.league = 'NFL'
         AND s.year = (SELECT MAX(year) FROM seasons WHERE league = 'NFL')
         AND w.number = $1
       GROUP BY w.id, s.year, w.number, w.label, w.is_current`,
      [weekNumber],
    );
  } else {
    row = await queryOne<WeekRow>(
      `${WEEK_SELECT} WHERE w.id = $1 GROUP BY w.id, s.year, w.number, w.label, w.is_current`,
      [ref],
    );
  }
  return row ? toWeek(row) : null;
}

/** Every game of a week, ordered by kickoff. */
export async function getWeekGames(weekId: string): Promise<v1.Game[]> {
  const { rows } = await query<GameRow>(
    `${GAME_SELECT} WHERE w.id = $1 ORDER BY g.scheduled_at, g.id`,
    [weekId],
  );
  return rows.map(toGame);
}
