import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { notFound, withApi } from "@/lib/api/with-api";
import { invalidatePushDevice } from "@/lib/auth/me-store";

/** DELETE /api/v1/me/push-devices/[id] — invalidate one of the member's own devices. */
export const DELETE = withApi(
  "me:push-devices:delete",
  { auth: "session", params: v1.DeletePushDeviceParamsSchema },
  async (_req, ctx) => {
    const revoked = await invalidatePushDevice(ctx.session!.userId, ctx.params.id);
    if (!revoked) throw notFound("Device not found.");
    return NextResponse.json({ ok: true, message: "Device removed." });
  },
);
