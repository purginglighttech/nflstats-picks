import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import { getSettings, updateSettings } from "@/lib/auth/me-store";

/** GET /api/v1/me/settings — theme settings (accent_source, luminance, timezone). */
export const GET = withApi("me:settings:get", { auth: "session" }, async (_req, ctx) => {
  const settings = await getSettings(ctx.session!.userId);
  return NextResponse.json({ settings });
});

/** PATCH /api/v1/me/settings — partial update; row created with defaults on first write. */
export const PATCH = withApi(
  "me:settings:patch",
  { auth: "session", body: v1.PatchUserSettingsRequestSchema },
  async (_req, ctx) => {
    const settings = await updateSettings(ctx.session!.userId, {
      accent_source: ctx.body.accent_source,
      luminance: ctx.body.luminance,
      timezone: ctx.body.timezone,
    });
    return NextResponse.json({ settings });
  },
);
