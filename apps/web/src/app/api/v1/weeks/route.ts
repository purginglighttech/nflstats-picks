import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import { getWeeks } from "@/lib/games";

/**
 * GET /api/v1/weeks — every ingested week of the latest season.
 * Public; powers the weekly-games index page.
 */
export const GET = withApi("weeks:list", { auth: "none" }, async () => {
  const weeks = await getWeeks();
  return NextResponse.json(v1.WeeksListResponseSchema.parse({ weeks }));
});

