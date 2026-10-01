import { NextResponse } from "next/server";
import { z } from "zod";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getWeekPicks } from "@/lib/competition/store";
import { getWeekByRef } from "@/lib/games";

/**
 * GET /api/v1/weeks/[id]/picks — the authenticated member's own saved picks
 * for every game of the week. Owner-only; another participant's picks are
 * never exposed here (the viewer gate).
 */
export const GET = withApi(
  "weeks:picks",
  {
    auth: "session",
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
    const picks = await getWeekPicks(ctx.session!.userId, week.id);
    return NextResponse.json(
      v1.WeekPicksResponseSchema.parse({ week_id: week.id, picks }),
    );
  },
);
