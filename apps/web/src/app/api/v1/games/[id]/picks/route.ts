import { NextResponse } from "next/server";
import { z } from "zod";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import {
  GameNotFoundError,
  InvalidPickTeamError,
  PickLockedError,
  getOwnPick,
  getRevealParticipants,
  getRevealSummary,
} from "@/lib/competition/store";

const budget = ROUTES_V1["/api/v1/games/[id]/picks"].GET.rateLimit;

/**
 * GET /api/v1/games/[id]/picks — the viewer gate, enforced.
 *
 * - Pre-lock: returns ONLY the authenticated member's own saved pick.
 *   No counts, no percentages, no other names — the autonomy rule.
 * - Post-lock: returns the reveal summary — committed counts and share of
 *   all eligible participants per team, with the explicit denominator.
 * - Post-lock with ?team_id=: the complete committed participant list for
 *   that team only, paginated server-side.
 *
 * Errors: 404 not_found, 409 pick_locked (sealed pre-lock / team detail
 * requested pre-lock), 400 invalid_request (bad team or cursor).
 */
export const GET = withApi(
  "games:picks",
  {
    auth: "session",
    // Mirrors the manifest entry (ROUTES_V1 types erase schema generics,
    // so the schemas are restated here for type inference).
    params: z.object({ id: z.string().min(1).max(64) }),
    query: z.object({
      team_id: z.string().min(1).max(8).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      cursor: z.string().min(1).max(128).optional(),
    }),
    rateLimit: budget,
  },
  async (_req, ctx) => {
    const userId = ctx.session!.userId;
    const gameId = ctx.params.id;

    try {
      if (ctx.query.team_id) {
        const list = await getRevealParticipants(
          gameId,
          ctx.query.team_id,
          ctx.query.limit,
          ctx.query.cursor,
        );
        return NextResponse.json(
          v1.RevealParticipantListResponseSchema.parse(list),
        );
      }

      try {
        const summary = await getRevealSummary(gameId);
        return NextResponse.json(
          v1.PickRevealSummarySchema.parse(summary),
        );
      } catch (err) {
        if (err instanceof PickLockedError) {
          // Pre-lock: the viewer gate — own pick only.
          const pick = await getOwnPick(userId, gameId);
          return NextResponse.json(
            v1.OwnPickResponseSchema.parse({ pick, locked: false }),
          );
        }
        throw err;
      }
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new ApiErrorException(404, "not_found", err.message);
      }
      if (err instanceof PickLockedError) {
        throw new ApiErrorException(409, "pick_locked", err.message);
      }
      if (err instanceof InvalidPickTeamError) {
        throw new ApiErrorException(400, "invalid_request", err.message);
      }
      throw err;
    }
  },
);
