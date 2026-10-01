import { NextResponse } from "next/server";
import { withApi } from "@/lib/api/with-api";
import {
  SESSION_COOKIE_NAME,
  clearSessionCookie,
} from "@/lib/auth/cookies";
import { revokeSession } from "@/lib/auth/session";
import { invalidateAllUserPushDevices } from "@/lib/auth/me-store";

/**
 * POST /api/v1/auth/signout
 *
 * Revokes the current session, clears the cookie, and invalidates the
 * member's push devices (spec: tokens invalidated on sign-out). Also serves
 * the native HTML form on /signout via content negotiation: browsers posting
 * the form get a 303 redirect to /signin.
 */
export const POST = withApi("auth:signout", { auth: "session" }, async (req, ctx) => {
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) await revokeSession(token);
  // ctx.session is guaranteed by auth: "session".
  await invalidateAllUserPushDevices(ctx.session!.userId);

  const acceptsHtml = (req.headers.get("accept") ?? "").includes("text/html");
  if (acceptsHtml) {
    const res = NextResponse.redirect(new URL("/signin?signed_out=1", req.url), 303);
    clearSessionCookie(res);
    return res;
  }

  const res = NextResponse.json({ ok: true, message: "Signed out." });
  clearSessionCookie(res);
  return res;
});
