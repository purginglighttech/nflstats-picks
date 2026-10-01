import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import {
  ApiErrorException,
  requireVerified,
  withApi,
} from "@/lib/api/with-api";
import { findUserById } from "@/lib/auth/users";
import {
  GameNotFoundError,
  IdempotencyConflictError,
  InvalidPickTeamError,
  NotPoolMemberError,
  PickLockedError,
  savePick,
} from "@/lib/competition/store";

const budget = ROUTES_V1["/api/v1/games/[id]/pick"].PUT.rateLimit;

/**
 * PUT /api/v1/games/[id]/pick — save or revise a pick (Phase 3).
 *
 * Implements the spec's request path for a pick: verified session,
 * active pool membership, server-time lock enforcement (kickoff minus five
 * minutes — the server clock is the authority), idempotency-keyed upsert,
 * and an append-only revision log.
 *
 * Errors:
 * - 401 unauthorized — no/invalid session
 * - 403 email_not_verified — verified email required for picks
 * - 403 not_pool_member — not an active member of the global pool
 * - 404 not_found — no such game
 * - 400 invalid_request — team not in this game / bad payload
 * - 409 pick_locked — at or past lock_at, or game no longer scheduled
 * - 409 idempotency_conflict — key reused with a different payload
 */
export const PUT = withApi(
  "games:pick",
  {
    auth: "session",
    params: v1.SavePickParamsSchema,
    body: v1.SavePickRequestSchema,
    rateLimit: budget,
  },
  async (_req, ctx) => {
    const user = await findUserById(ctx.session!.userId);
    requireVerified(user ? { emailVerified: user.emailVerified } : null);

    try {
      const pick = await savePick({
        userId: ctx.session!.userId,
        gameId: ctx.params.id,
        selectedTeamAbbr: ctx.body.selected_team_id,
        idempotencyKey: ctx.body.idempotency_key,
      });
      return NextResponse.json(v1.SavePickResponseSchema.parse({ pick }));
    } catch (err) {
      if (err instanceof GameNotFoundError) {
        throw new ApiErrorException(404, "not_found", err.message);
      }
      if (err instanceof PickLockedError) {
        throw new ApiErrorException(409, "pick_locked", err.message);
      }
      if (err instanceof NotPoolMemberError) {
        throw new ApiErrorException(403, "not_pool_member", err.message);
      }
      if (err instanceof IdempotencyConflictError) {
        throw new ApiErrorException(409, "idempotency_conflict", err.message);
      }
      if (err instanceof InvalidPickTeamError) {
        throw new ApiErrorException(400, "invalid_request", err.message);
      }
      throw err;
    }
  },
);
