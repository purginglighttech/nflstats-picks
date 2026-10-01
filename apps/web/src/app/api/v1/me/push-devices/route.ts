import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { withApi } from "@/lib/api/with-api";
import { registerPushDevice } from "@/lib/auth/me-store";

/**
 * POST /api/v1/me/push-devices — register a device for push delivery.
 * The raw provider token is stored server-side (worker-only) and never
 * returned; the response carries only the device id.
 */
export const POST = withApi(
  "me:push-devices:post",
  { auth: "session", body: v1.RegisterPushDeviceRequestSchema },
  async (_req, ctx) => {
    const device = await registerPushDevice(ctx.session!.userId, {
      device_token: ctx.body.device_token,
      platform: ctx.body.platform,
      installation_id: ctx.body.installation_id,
      app_version: ctx.body.app_version,
      locale: ctx.body.locale,
    });
    return NextResponse.json({ device }, { status: 201 });
  },
);
