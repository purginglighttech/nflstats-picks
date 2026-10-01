import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getWeekByRef, getWeekGames } from "@/lib/games";

/**
 * GET /api/v1/weeks/[id]/games — the ballot schedule.
 * `id` is a week UUID or a week number within the latest season.
 * 404 with `week_not_found` when the week does not exist.
 */
export const GET = withApi(
  "weeks:games",
  {
    auth: "none",
    params: z.object({ id: z.string().min(1).max(64) }),
  },
  async (_req, ctx) => {
    const week = await getWeekByRef(ctx.params.id);
    if (!week) {
      throw new ApiErrorException(
        404,
        "week_not_found",
        `No such week: ${ctx.params.id}.`,
      );
    }
    const games = await getWeekGames(week.id);
    return NextResponse.json(
      v1.BallotScheduleResponseSchema.parse({ week_id: week.id, games }),
    );
  },
);
