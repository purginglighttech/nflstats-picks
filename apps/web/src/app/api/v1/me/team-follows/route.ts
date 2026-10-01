import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import {
  UnknownTeamError,
  getTeamFollows,
  replaceTeamFollows,
} from "@/lib/auth/me-store";

/** GET /api/v1/me/team-follows — ranked fandom hierarchy. */
export const GET = withApi(
  "me:team-follows:get",
  { auth: "session" },
  async (_req, ctx) => {
    const follows = await getTeamFollows(ctx.session!.userId);
    return NextResponse.json({ follows });
  },
);

/**
 * PUT /api/v1/me/team-follows — replace the whole hierarchy atomically;
 * rank_position derives from array order (first entry = 1).
 */
export const PUT = withApi(
  "me:team-follows:put",
  { auth: "session", body: v1.PutTeamFollowsRequestSchema },
  async (_req, ctx) => {
    try {
      const follows = await replaceTeamFollows(
        ctx.session!.userId,
        ctx.body.follows.map((f) => ({ team_id: f.team_id, active: f.active })),
      );
      return NextResponse.json({ follows });
    } catch (err) {
      if (err instanceof UnknownTeamError) {
        throw new ApiErrorException(400, "invalid_request", err.message);
      }
      throw err;
    }
  },
);
