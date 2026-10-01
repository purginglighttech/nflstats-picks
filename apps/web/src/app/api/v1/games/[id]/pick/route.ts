import { ROUTES_V1, v1 } from "@pickem/contracts";
import {
  ApiErrorException,
  notFound,
  withApi,
} from "@/lib/api/with-api";
import { isUndefinedTableError, queryOne } from "@/lib/db";

const budget = ROUTES_V1["/api/v1/games/[id]/pick"].PUT.rateLimit;

/**
 * PUT /api/v1/games/[id]/pick — Phase 1: auth + validation + game-exists
 * check run for real; the pick write itself returns 501 not_implemented
 * until Phase 3 (server-time lock check, idempotency, append-only revisions).
 *
 * NOTE: the games table may not be migrated yet in early Phase 1; an
 * undefined-table error is treated as "no games seeded" (404) rather than a
 * 500. Remove this tolerance once sibling B's migrations are the baseline.
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
    let game: { id: string } | undefined;
    try {
      game = await queryOne<{ id: string }>(
        `SELECT id FROM games WHERE id = $1`,
        [ctx.params.id],
      );
    } catch (err) {
      if (isUndefinedTableError(err)) game = undefined;
      else throw err;
    }
    if (!game) throw notFound("Game not found.");

    throw new ApiErrorException(
      501,
      "not_implemented",
      "Pick saving lands in Phase 3 (locking, idempotency, audit).",
    );
  },
);
