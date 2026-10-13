/**
 * Team read queries: identity, season records, schedule, player leaders,
 * and the pool's graded pick record.
 *
 * Server-only. Data-layer display only — everything here traces to the
 * games / picks / player_game_stats tables; no derived analysis.
 *
 * Player-stat attribution follows the box-score read path (migration 010):
 * player_game_stats.team_id when populated, else the game_leaders
 * attribution for rows ingested before the column existed.
 */
import { query, queryOne } from "@/lib/db";

export interface TeamRow {
  id: string;
  abbreviation: string;
  city: string;
  name: string;
  conference: string;
  division: string;
  accent_light: string;
  accent_dark: string;
}

export interface TeamRecordRow extends TeamRow {
  wins: number;
  losses: number;
  ties: number;
  points_for: number;
  points_against: number;
}

/** Latest NFL season year in the database. */
export async function getLatestSeasonYear(): Promise<number | null> {
  const row = await queryOne<{ year: number }>(
    `SELECT MAX(year) AS year FROM seasons WHERE league = 'NFL'`
  );
  return row?.year ?? null;
}

export async function getTeamByAbbr(abbr: string): Promise<TeamRow | undefined> {
  return queryOne<TeamRow>(
    `SELECT id, abbreviation, city, name, conference, division,
            accent_light, accent_dark
     FROM teams WHERE abbreviation = $1`,
    [abbr.toUpperCase()]
  );
}

/** All 32 teams with their final-game record for one season. */
export async function getTeamsWithRecords(
  seasonYear: number
): Promise<TeamRecordRow[]> {
  const { rows } = await query<TeamRecordRow>(
    `WITH season_games AS (
       SELECT g.id, g.home_team_id, g.away_team_id, g.status, g.result_revision_id
       FROM games g
       JOIN weeks w ON w.id = g.week_id
       JOIN seasons s ON s.id = w.season_id
       WHERE s.league = 'NFL' AND s.year = $1
     ),
     records AS (
       SELECT t.id AS team_id,
         COUNT(*) FILTER (
           WHERE (sg.home_team_id = t.id AND r.home_score > r.away_score)
              OR (sg.away_team_id = t.id AND r.away_score > r.home_score)
         )::int AS wins,
         COUNT(*) FILTER (
           WHERE (sg.home_team_id = t.id AND r.home_score < r.away_score)
              OR (sg.away_team_id = t.id AND r.away_score < r.home_score)
         )::int AS losses,
         COUNT(*) FILTER (
           WHERE r.home_score = r.away_score
         )::int AS ties,
         COALESCE(SUM(CASE WHEN sg.home_team_id = t.id THEN r.home_score
                           WHEN sg.away_team_id = t.id THEN r.away_score END), 0)::int AS points_for,
         COALESCE(SUM(CASE WHEN sg.home_team_id = t.id THEN r.away_score
                           WHEN sg.away_team_id = t.id THEN r.home_score END), 0)::int AS points_against
       FROM teams t
       JOIN season_games sg ON sg.home_team_id = t.id OR sg.away_team_id = t.id
       LEFT JOIN game_result_revisions r ON r.id = sg.result_revision_id
       WHERE sg.status = 'final'
       GROUP BY t.id
     )
     SELECT t.id, t.abbreviation, t.city, t.name, t.conference, t.division,
            t.accent_light, t.accent_dark,
            COALESCE(rec.wins, 0) AS wins,
            COALESCE(rec.losses, 0) AS losses,
            COALESCE(rec.ties, 0) AS ties,
            COALESCE(rec.points_for, 0) AS points_for,
            COALESCE(rec.points_against, 0) AS points_against
     FROM teams t
     LEFT JOIN records rec ON rec.team_id = t.id
     ORDER BY t.conference, t.division, t.city`,
    [seasonYear]
  );
  return rows;
}

export interface TeamScheduleRow {
  game_id: string;
  week_id: string;
  week_number: number;
  week_label: string;
  scheduled_at: Date | string;
  status: string;
  opponent: string;
  is_home: boolean;
  team_score: number | null;
  opponent_score: number | null;
}

export async function getTeamSchedule(
  teamId: string,
  seasonYear: number
): Promise<TeamScheduleRow[]> {
  const { rows } = await query<TeamScheduleRow>(
    `SELECT g.id AS game_id, w.id AS week_id, w.number AS week_number,
            w.label AS week_label, g.scheduled_at, g.status,
            CASE WHEN g.home_team_id = $1 THEN ta.abbreviation
                 ELSE th.abbreviation END AS opponent,
            (g.home_team_id = $1) AS is_home,
            CASE WHEN g.home_team_id = $1 THEN r.home_score
                 ELSE r.away_score END AS team_score,
            CASE WHEN g.home_team_id = $1 THEN r.away_score
                 ELSE r.home_score END AS opponent_score
     FROM games g
     JOIN weeks w ON w.id = g.week_id
     JOIN seasons s ON s.id = w.season_id
     JOIN teams th ON th.id = g.home_team_id
     JOIN teams ta ON ta.id = g.away_team_id
     LEFT JOIN game_result_revisions r ON r.id = g.result_revision_id
     WHERE s.league = 'NFL' AND s.year = $2
       AND (g.home_team_id = $1 OR g.away_team_id = $1)
     ORDER BY w.number, g.scheduled_at`,
    [teamId, seasonYear]
  );
  return rows;
}

export interface TeamLeaderRow {
  player_name: string;
  yards: number;
  touchdowns: number;
  receptions: number | null;
}

const LEADER_METRICS: Record<
  "passing" | "rushing" | "receiving",
  { yards: string; touchdowns: string; extra: string | null }
> = {
  passing: { yards: "passingYards", touchdowns: "passingTouchdowns", extra: null },
  rushing: { yards: "rushingYards", touchdowns: "rushingTouchdowns", extra: null },
  receiving: { yards: "receivingYards", touchdowns: "receivingTouchdowns", extra: "receptions" },
};

/** Season leader for one stat category, by total yards. */
export async function getTeamLeader(
  teamId: string,
  seasonYear: number,
  category: "passing" | "rushing" | "receiving"
): Promise<TeamLeaderRow | null> {
  const m = LEADER_METRICS[category];
  // Placeholders: $1 team, $2 season, $3 yards key, $4 touchdowns key,
  // then (receiving only) $5 receptions key, and category last.
  const receptionsSelect = m.extra
    ? `COALESCE(SUM(s.metric_value) FILTER (WHERE s.metric_key = $5), 0)::double precision`
    : "NULL";
  const categoryParam = m.extra ? "$6" : "$5";
  const params = m.extra
    ? [teamId, seasonYear, m.yards, m.touchdowns, m.extra, category]
    : [teamId, seasonYear, m.yards, m.touchdowns, category];
  const row = await queryOne<TeamLeaderRow>(
    `SELECT s.player_name,
            COALESCE(SUM(s.metric_value) FILTER (WHERE s.metric_key = $3), 0)::double precision AS yards,
            COALESCE(SUM(s.metric_value) FILTER (WHERE s.metric_key = $4), 0)::double precision AS touchdowns,
            ${receptionsSelect} AS receptions
     FROM player_game_stats s
     JOIN games g ON g.id = s.game_id
     JOIN weeks w ON w.id = g.week_id
     JOIN seasons se ON se.id = w.season_id
     WHERE se.league = 'NFL' AND se.year = $2
       AND s.category_key = ${categoryParam}
       AND s.player_name IS NOT NULL
       AND (
         s.team_id = $1
         OR (s.team_id IS NULL AND EXISTS (
           SELECT 1 FROM game_leaders l
           WHERE l.game_id = s.game_id
             AND l.player_external_id = s.player_external_id
             AND l.team_id = $1
         ))
       )
     GROUP BY s.player_external_id, s.player_name
     HAVING SUM(s.metric_value) FILTER (WHERE s.metric_key = $3) IS NOT NULL
     ORDER BY yards DESC
     LIMIT 1`,
    params
  );
  return row ?? null;
}

export interface TeamPoolRow {
  user_id: string;
  display_name: string;
  for_picks: number;
  for_wins: number;
  for_losses: number;
  for_ties: number;
  against_picks: number;
  against_wins: number;
  against_losses: number;
  against_ties: number;
}

/**
 * Each participant's graded pick record on this team's final games:
 * picks that selected the team ("for") vs picks that selected its
 * opponent ("against"). Records are the pick's own grade.
 */
export async function getTeamPoolRecords(
  teamId: string,
  seasonYear: number
): Promise<TeamPoolRow[]> {
  const { rows } = await query<TeamPoolRow>(
    `SELECT u.id AS user_id, pr.display_name,
            COUNT(*) FILTER (WHERE p.selected_team_id = $1)::int AS for_picks,
            COUNT(*) FILTER (WHERE p.selected_team_id = $1 AND p.grade = 'win')::int AS for_wins,
            COUNT(*) FILTER (WHERE p.selected_team_id = $1 AND p.grade = 'loss')::int AS for_losses,
            COUNT(*) FILTER (WHERE p.selected_team_id = $1 AND p.grade = 'tie')::int AS for_ties,
            COUNT(*) FILTER (WHERE p.selected_team_id <> $1)::int AS against_picks,
            COUNT(*) FILTER (WHERE p.selected_team_id <> $1 AND p.grade = 'win')::int AS against_wins,
            COUNT(*) FILTER (WHERE p.selected_team_id <> $1 AND p.grade = 'loss')::int AS against_losses,
            COUNT(*) FILTER (WHERE p.selected_team_id <> $1 AND p.grade = 'tie')::int AS against_ties
     FROM picks p
     JOIN games g ON g.id = p.game_id
     JOIN weeks w ON w.id = g.week_id
     JOIN seasons s ON s.id = w.season_id
     JOIN users u ON u.id = p.user_id
     JOIN profiles pr ON pr.user_id = u.id
     WHERE s.league = 'NFL' AND s.year = $2
       AND (g.home_team_id = $1 OR g.away_team_id = $1)
       AND g.status = 'final'
       AND p.committed_at IS NOT NULL
       AND p.grade IN ('win', 'loss', 'tie')
     GROUP BY u.id, pr.display_name
     ORDER BY pr.display_name`,
    [teamId, seasonYear]
  );
  return rows;
}
