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

/** Every ingested week of the latest season, ordered by week number. */
export async function getWeeks(): Promise<v1.Week[]> {
  const { rows } = await query<WeekRow>(
    `${WEEK_SELECT}
     WHERE s.league = 'NFL'
       AND s.year = (SELECT MAX(year) FROM seasons WHERE league = 'NFL')
     GROUP BY w.id, s.year, w.number, w.label, w.is_current
     ORDER BY w.number`,
  );
  return rows.map(toWeek);
}

/** One game by UUID. Returns null when nothing matches. */
export async function getGameById(gameId: string): Promise<v1.Game | null> {
  const row = await queryOne<GameRow>(`${GAME_SELECT} WHERE g.id = $1`, [
    gameId,
  ]);
  return row ? toGame(row) : null;
}

interface TeamStatRow {
  team: string;
  metric_key: string;
  display_label: string | null;
  display_value: string | null;
  metric_value: string | null; // pg numeric arrives as string
  unit: string | null;
  category: string | null;
  position: number;
}

interface PlayerStatRow {
  team: string | null;
  player_name: string | null;
  category_key: string;
  metric_key: string;
  display_label: string | null;
  display_value: string | null; // provider verbatim raw_value
  metric_value: string | null;
  unit: string | null;
}

interface LeaderRow {
  team: string;
  category_key: string;
  category_label: string | null;
  rank: number;
  player_name: string | null;
  display_value: string | null;
  metric_value: string | null;
}

interface PeriodRow {
  team: string;
  period_number: number;
  points: number;
}

function toNumber(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The canonical game-page payload: game, scoring periods, team stats,
 * player stats, and game leaders. Sections the pipeline has not delivered
 * yet come back empty; the page renders those as honest empty states.
 */
export async function getGameBoxScore(
  gameId: string,
): Promise<v1.GameBoxScoreResponse | null> {
  const game = await getGameById(gameId);
  if (!game) return null;

  const [periods, teamStats, playerStats, leaders] = await Promise.all([
    query<PeriodRow>(
      `SELECT t.abbreviation AS team, sp.period_number, sp.points
       FROM scoring_periods sp
       JOIN teams t ON t.id = sp.team_id
       WHERE sp.game_id = $1
       ORDER BY t.abbreviation, sp.period_number`,
      [gameId],
    ),
    query<TeamStatRow>(
      `SELECT t.abbreviation AS team, s.metric_key, s.display_label,
              s.display_value, s.metric_value::text AS metric_value,
              s.unit, s.category, s.position
       FROM team_game_stats s
       JOIN teams t ON t.id = s.team_id
       WHERE s.game_id = $1
       ORDER BY t.abbreviation, s.position, s.metric_key`,
      [gameId],
    ),
    query<PlayerStatRow>(
      `SELECT COALESCE(t.abbreviation, lt.abbreviation) AS team,
              s.player_name, s.category_key,
              s.metric_key, s.display_label,
              s.raw_value AS display_value, s.metric_value::text AS metric_value,
              s.unit
       FROM player_game_stats s
       LEFT JOIN teams t ON t.id = s.team_id
       LEFT JOIN LATERAL (
         SELECT t2.abbreviation
         FROM game_leaders l
         JOIN teams t2 ON t2.id = l.team_id
         WHERE l.game_id = s.game_id
           AND l.player_external_id = s.player_external_id
         LIMIT 1
       ) lt ON true
       WHERE s.game_id = $1
       ORDER BY team NULLS LAST, s.category_key, s.player_name, s.metric_key`,
      [gameId],
    ),
    query<LeaderRow>(
      `SELECT t.abbreviation AS team, l.category_key, l.category_label,
              l.rank, l.player_name, l.display_value,
              l.metric_value::text AS metric_value
       FROM game_leaders l
       JOIN teams t ON t.id = l.team_id
       WHERE l.game_id = $1
       ORDER BY t.abbreviation, l.category_key, l.rank`,
      [gameId],
    ),
  ]);

  return {
    game,
    periods: periods.rows.map((r) => ({
      team_id: r.team as v1.NflTeam,
      period_number: r.period_number,
      points: r.points,
    })),
    team_stats: teamStats.rows.map((r) => ({
      team_id: r.team as v1.NflTeam,
      metric_key: r.metric_key,
      display_label: r.display_label,
      display_value: r.display_value,
      metric_value: toNumber(r.metric_value),
      unit: r.unit,
      category: r.category,
      position: r.position,
    })),
    player_stats: playerStats.rows.map((r) => ({
      team_id: r.team as v1.NflTeam | null,
      player_name: r.player_name,
      category_key: r.category_key,
      category_label: null,
      metric_key: r.metric_key,
      display_label: r.display_label,
      display_value: r.display_value,
      metric_value: toNumber(r.metric_value),
      unit: r.unit,
    })),
    leaders: leaders.rows.map((r) => ({
      team_id: r.team as v1.NflTeam,
      category_key: r.category_key,
      category_label: r.category_label,
      rank: r.rank,
      player_name: r.player_name,
      display_value: r.display_value,
      metric_value: toNumber(r.metric_value),
    })),
  };
}
