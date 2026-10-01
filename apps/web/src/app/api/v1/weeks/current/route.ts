import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getCurrentWeek } from "@/lib/games";

/**
 * GET /api/v1/weeks/current — the week the product orients on.
 * 404 with `week_not_found` when no weeks have been ingested yet.
 */
export const GET = withApi("weeks:current", { auth: "none" }, async () => {
  const week = await getCurrentWeek();
  if (!week) {
    throw new ApiErrorException(
      404,
      "week_not_found",
      "No weeks ingested yet.",
    );
  }
  return NextResponse.json(v1.CurrentWeekResponseSchema.parse({ week }));
});
