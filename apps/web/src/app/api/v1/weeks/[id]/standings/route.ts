import { z } from "zod";
import { ApiErrorException, withApi } from "@/lib/api/with-api";

/**
 * GET /api/v1/weeks/[id]/standings — Phase 1: 501 not_implemented.
 * Scoring, grading, and the weekly_scores projections land in Phase 3+;
 * the contract shape is `WeeklyStandingsResponse` in @pickem/contracts.
 */
export const GET = withApi(
  "weeks:standings",
  {
    auth: "none",
    params: z.object({ id: z.string().min(1).max(64) }),
  },
  async () => {
    throw new ApiErrorException(
      501,
      "not_implemented",
      "Weekly standings land with scoring (Phase 3+).",
    );
  },
);
