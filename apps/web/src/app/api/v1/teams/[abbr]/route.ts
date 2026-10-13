import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import {
  getLatestSeasonYear,
  getTeamByAbbr,
  getTeamLeader,
  getTeamPoolRecords,
  getTeamSchedule,
  getTeamsWithRecords,
} from "@/lib/teams";

/**
 * GET /api/v1/teams/[abbr] — one team for the latest season: identity and
 * record, full schedule with results, season player leaders, and the
 * pool's graded pick record on the team's games. Public read.
 */
export const GET = withApi(
  "teams:detail",
  {
    auth: "none",
    params: z.object({ abbr: z.string().min(2).max(3) }),
  },
  async (_req, ctx) => {
    const season = await getLatestSeasonYear();
    if (season === null) {
      throw new ApiErrorException(404, "season_not_found", "No NFL season data.");
    }

    const team = await getTeamByAbbr(ctx.params.abbr);
    if (!team) {
      throw new ApiErrorException(404, "team_not_found", `No such team: ${ctx.params.abbr}.`);
    }

    const [records, schedule, passing, rushing, receiving, pool] = await Promise.all([
      getTeamsWithRecords(season),
      getTeamSchedule(team.id, season),
      getTeamLeader(team.id, season, "passing"),
      getTeamLeader(team.id, season, "rushing"),
      getTeamLeader(team.id, season, "receiving"),
      getTeamPoolRecords(team.id, season),
    ]);
    const summary = records.find((r) => r.id === team.id);

    return NextResponse.json(
      v1.TeamDetailResponseSchema.parse({
        season,
        team: {
          abbreviation: team.abbreviation,
          city: team.city,
          name: team.name,
          conference: team.conference,
          division: team.division,
          accent_light: team.accent_light,
          accent_dark: team.accent_dark,
          wins: summary?.wins ?? 0,
          losses: summary?.losses ?? 0,
          ties: summary?.ties ?? 0,
          points_for: summary?.points_for ?? 0,
          points_against: summary?.points_against ?? 0,
        },
        schedule: schedule.map((g) => ({
          game_id: g.game_id,
          week_id: g.week_id,
          week_number: g.week_number,
          week_label: g.week_label,
          scheduled_at: new Date(g.scheduled_at).toISOString(),
          status: g.status,
          opponent: g.opponent,
          is_home: g.is_home,
          team_score: g.team_score,
          opponent_score: g.opponent_score,
          result:
            g.status === "final" && g.team_score !== null && g.opponent_score !== null
              ? g.team_score > g.opponent_score
                ? "W"
                : g.team_score < g.opponent_score
                  ? "L"
                  : "T"
              : null,
        })),
        leaders: { passing, rushing, receiving },
        pool: pool.map((p) => ({
          user_id: p.user_id,
          display_name: p.display_name,
          picked_for: {
            picks: p.for_picks,
            wins: p.for_wins,
            losses: p.for_losses,
            ties: p.for_ties,
          },
          picked_against: {
            picks: p.against_picks,
            wins: p.against_wins,
            losses: p.against_losses,
            ties: p.against_ties,
          },
        })),
      })
    );
  }
);
