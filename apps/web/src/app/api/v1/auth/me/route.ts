import { NextResponse } from "next/server";
import { withApi, unauthorized } from "@/lib/api/with-api";
import { profileJson } from "@/lib/api/shapes";
import { findUserById } from "@/lib/auth/users";

/**
 * GET /api/v1/auth/me — the current session's account identity.
 */
export const GET = withApi("auth:me", { auth: "session" }, async (_req, ctx) => {
  // ctx.session is guaranteed by auth: "session".
  const user = await findUserById(ctx.session!.userId);
  if (!user) throw unauthorized();
  return NextResponse.json({ user: profileJson(user) });
});
