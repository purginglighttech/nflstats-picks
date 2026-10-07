import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getGameBoxScore } from "@/lib/games";

/**
 * GET /api/v1/games/[id] — the canonical game page payload: the game plus
 * its box-score sections (scoring periods, team stats, player stats,
 * leaders). One URL serves all three life phases (scheduled, in_progress,
 * final); sections the pipeline has not delivered yet come back empty.
 * 404 with `game_not_found` when the game does not exist.
 */
export const GET = withApi(
  "games:boxscore",
  {
    auth: "none",
    params: z.object({ id: z.string().min(1).max(64) }),
  },
  async (_req, ctx) => {
    const boxScore = await getGameBoxScore(ctx.params.id);
    if (!boxScore) {
      throw new ApiErrorException(
        404,
        "game_not_found",
        `No such game: ${ctx.params.id}.`,
      );
    }
    return NextResponse.json(v1.GameBoxScoreResponseSchema.parse(boxScore));
  },
);
