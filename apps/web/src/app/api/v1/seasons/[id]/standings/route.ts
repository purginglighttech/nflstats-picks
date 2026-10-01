import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { rankStandings } from "@/lib/competition/ranking";
import { getSeasonByRef, getSeasonStandingRows } from "@/lib/competition/store";

/**
 * GET /api/v1/seasons/[id]/standings — season ranking (Phase 3).
 *
 * `id` is a season year (e.g. 2026) or a season UUID. Weekly projections
 * are summed; the same spec-decision-#4 rank order applies.
 */
export const GET = withApi(
  "seasons:standings",
  {
    auth: "none",
    params: z.object({ id: z.string().min(1).max(64) }),
  },
  async (_req, ctx) => {
    const season = await getSeasonByRef(ctx.params.id);
    if (!season) {
      throw new ApiErrorException(
        404,
        "season_not_found",
        `No such season: ${ctx.params.id}.`,
      );
    }
    const rows = await getSeasonStandingRows(season.year);
    const ranked = rankStandings(rows);
    const updatedAt =
      rows.length > 0
        ? rows
            .map((r) => r.updated_at)
            .sort()
            .at(-1)!
        : new Date(0).toISOString();
    return NextResponse.json(
      v1.SeasonStandingsResponseSchema.parse({
        season: season.year,
        standings: ranked.map((r) => ({
          season: season.year,
          user_id: r.row.user_id,
          display_name: r.row.display_name,
          wins: r.row.wins,
          losses: r.row.losses,
          ties: r.row.ties,
          misses: r.row.misses,
          accuracy: r.accuracy,
          completed_picks: r.completed,
          rank: r.rank,
          games_behind: r.games_behind,
          updated_at: r.row.updated_at,
        })),
        updated_at: updatedAt,
      }),
    );
  },
);
