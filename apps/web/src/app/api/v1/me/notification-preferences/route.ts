import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/auth/me-store";

/** GET /api/v1/me/notification-preferences — the four explicit alert opt-ins. */
export const GET = withApi(
  "me:notification-preferences:get",
  { auth: "session" },
  async (_req, ctx) => {
    const preferences = await getNotificationPreferences(ctx.session!.userId);
    return NextResponse.json({ preferences });
  },
);

/** PATCH /api/v1/me/notification-preferences — upsert opt-ins by event_type. */
export const PATCH = withApi(
  "me:notification-preferences:patch",
  { auth: "session", body: v1.PatchNotificationPreferencesRequestSchema },
  async (_req, ctx) => {
    const preferences = await updateNotificationPreferences(
      ctx.session!.userId,
      ctx.body.preferences,
    );
    return NextResponse.json({ preferences });
  },
);
