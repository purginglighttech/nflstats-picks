import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { SESSION_COOKIE_NAME, setSessionCookie } from "@/lib/auth/cookies";
import { createSession, rotateSession } from "@/lib/auth/session";
import { consumeVerificationToken } from "@/lib/auth/users";

const budget = ROUTES_V1["/api/v1/auth/verify"].GET.rateLimit;

/**
 * GET /api/v1/auth/verify?token=
 *
 * Consumes a single-use 24h verification token (constant-time comparison).
 * Invalid / expired / already-used tokens all return the same 400.
 * The session rotates when one exists; otherwise the verified email signs
 * the member in with a fresh session (the link proves email ownership).
 */
export const GET = withApi(
  "auth:verify",
  { auth: "none", query: v1.VerifyEmailQuerySchema, rateLimit: budget },
  async (req, ctx) => {
    const userId = await consumeVerificationToken(ctx.query.token);
    if (!userId) {
      throw new ApiErrorException(
        400,
        "invalid_request",
        "This verification link is invalid or has expired.",
      );
    }

    const oldToken = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const session = oldToken
      ? await rotateSession(userId, oldToken)
      : await createSession(userId);

    const res = NextResponse.json({
      ok: true,
      message: "Email verified. You are signed in.",
    });
    setSessionCookie(res, session.token);
    return res;
  },
);
