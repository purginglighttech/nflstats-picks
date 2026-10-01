import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api/with-api";

/**
 * GET /api/v1/weeks/[id]/games — the ballot schedule.
 * Phase 1: 200 with an empty games array (no games seeded yet).
 */
export const GET = withApi(
  "weeks:games",
  {
    auth: "none",
    params: z.object({ id: z.string().min(1).max(64) }),
  },
  async (_req, ctx) => {
    return NextResponse.json({ week_id: ctx.params.id, games: [] });
  },
);
