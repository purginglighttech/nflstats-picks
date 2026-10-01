import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/cookies";
import { createSession, revokeAllUserSessions } from "@/lib/auth/session";
import { consumeResetToken } from "@/lib/auth/users";

const budget = ROUTES_V1["/api/v1/auth/reset-password"].POST.rateLimit;

/**
 * POST /api/v1/auth/reset-password
 *
 * Consumes a single-use 1h reset token (constant-time comparison) and sets
 * the new password atomically. All existing sessions are revoked — a
 * sensitive account change — then a fresh session signs the member in.
 * Invalid / expired / already-used tokens all return the same 400.
 */
export const POST = withApi(
  "auth:reset-password",
  { auth: "none", body: v1.ResetPasswordRequestSchema, rateLimit: budget },
  async (_req, ctx) => {
    const userId = await consumeResetToken(
      ctx.body.token,
      await hashPassword(ctx.body.new_password),
    );
    if (!userId) {
      throw new ApiErrorException(
        400,
        "invalid_request",
        "This reset link is invalid or has expired.",
      );
    }

    await revokeAllUserSessions(userId);
    const session = await createSession(userId);

    const res = NextResponse.json({
      ok: true,
      message: "Password updated. You are signed in.",
    });
    setSessionCookie(res, session.token);
    return res;
  },
);
