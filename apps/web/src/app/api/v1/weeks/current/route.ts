import { ApiErrorException, withApi } from "@/lib/api/with-api";

/**
 * GET /api/v1/weeks/current — Phase 1: 501 not_implemented.
 * The active-week resolver depends on the sports-data rollout (Phase 2);
 * the contract shape is `CurrentWeekResponse` in @pickem/contracts.
 */
export const GET = withApi("weeks:current", { auth: "none" }, async () => {
  throw new ApiErrorException(
    501,
    "not_implemented",
    "The current-week resolver lands with the sports-data rollout (Phase 2).",
  );
});
