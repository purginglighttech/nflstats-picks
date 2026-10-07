import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getHeadToHeadGames, getCompareUsers } from "@/lib/competition/store";
import { getWeekByRef } from "@/lib/games";
import { getSeasonByRef } from "@/lib/competition/store";

/**
 * GET /api/v1/compare — head-to-head game ledger for two participants.
 *
 * Query: user_a (uuid), user_b (uuid), and either week_id (uuid) or
 * season (year). Only final games are returned — picks stay sealed
 * pre-lock. Public participant data only.
 */
export const GET = withApi(
  "compare:head-to-head",
  {
    auth: "none",
    query: z
      .object({
        user_a: z.string().uuid(),
        user_b: z.string().uuid(),
        week_id: z.string().uuid().optional(),
        season: z.coerce.number().int().min(2000).max(2100).optional(),
      })
      .refine((q) => q.week_id || q.season, {
        message: "week_id or season is required",
      })
      .refine((q) => q.user_a !== q.user_b, {
        message: "user_a and user_b must differ",
      }),
  },
  async (_req, ctx) => {
    const { user_a, user_b, week_id, season } = ctx.query;

    const users = await getCompareUsers(user_a, user_b);
    const userA = users.find((u) => u.user_id === user_a);
    const userB = users.find((u) => u.user_id === user_b);
    if (!userA || !userB) {
      throw new ApiErrorException(404, "user_not_found", "Participant not found.");
    }

    let scope: { weekId: string } | { seasonYear: number };
    let seasonYear: number;
    let scopeWeekId: string | null = null;

    if (week_id) {
      const week = await getWeekByRef(week_id);
      if (!week) {
        throw new ApiErrorException(404, "week_not_found", `No such week: ${week_id}.`);
      }
      scope = { weekId: week.id };
      seasonYear = week.season;
      scopeWeekId = week.id;
    } else {
      const s = await getSeasonByRef(String(season!));
      if (!s) {
        throw new ApiErrorException(404, "season_not_found", `No such season: ${season}.`);
      }
      scope = { seasonYear: s.year };
      seasonYear = s.year;
    }

    const games = await getHeadToHeadGames(user_a, user_b, scope);

    let agreed = 0;
    let disagreed = 0;
    let aDisagreementWins = 0;
    let bDisagreementWins = 0;
    for (const g of games) {
      if (g.agreed) {
        agreed += 1;
      } else {
        disagreed += 1;
        if (g.user_a_grade === "win" && g.user_b_grade !== "win") aDisagreementWins += 1;
        else if (g.user_b_grade === "win" && g.user_a_grade !== "win") bDisagreementWins += 1;
      }
    }

    return NextResponse.json(
      v1.HeadToHeadResponseSchema.parse({
        user_a: { user_id: userA.user_id, display_name: userA.display_name },
        user_b: { user_id: userB.user_id, display_name: userB.display_name },
        week_id: scopeWeekId,
        season: seasonYear,
        games: games.map((g) => ({
          game_id: g.game_id,
          week_id: g.week_id,
          week_number: g.week_number,
          away_team: g.away_team,
          home_team: g.home_team,
          away_score: g.away_score,
          home_score: g.home_score,
          status: g.status,
          user_a_pick: g.user_a_pick,
          user_b_pick: g.user_b_pick,
          user_a_grade: g.user_a_grade,
          user_b_grade: g.user_b_grade,
          agreed: g.agreed,
        })),
        summary: {
          games: games.length,
          agreed,
          disagreed,
          user_a_disagreement_wins: aDisagreementWins,
          user_b_disagreement_wins: bDisagreementWins,
        },
      })
    );
  }
);
