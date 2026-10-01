import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import {
  ApiErrorException,
  ensureMinLatency,
  withApi,
} from "@/lib/api/with-api";
import { SESSION_COOKIE_NAME, setSessionCookie } from "@/lib/auth/cookies";
import { verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { rotateSession } from "@/lib/auth/session";
import { findUserByEmail } from "@/lib/auth/users";

const budget = ROUTES_V1["/api/v1/auth/signin"].POST.rateLimit;

/**
 * POST /api/v1/auth/signin
 *
 * Unknown emails run a dummy argon2 verify so the timing profile matches a
 * real password check; both failure cases return the identical 401
 * invalid_credentials. Success rotates the session (any previous token for
 * this browser is revoked) and sets the cookie.
 */
export const POST = withApi(
  "auth:signin",
  { auth: "none", body: v1.SigninRequestSchema, rateLimit: budget },
  async (req, ctx) => {
    const startedAt = Date.now();
    const { email, password } = ctx.body;

    const user = await findUserByEmail(email);
    const passwordOk = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);

    if (!user || !passwordOk) {
      await ensureMinLatency(startedAt);
      throw new ApiErrorException(
        401,
        "invalid_credentials",
        "Invalid email or password.",
      );
    }

    const oldToken = req.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
    const session = await rotateSession(user.id, oldToken);

    const res = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.displayName,
        email_verified: user.emailVerified,
      },
    });
    setSessionCookie(res, session.token);
    await ensureMinLatency(startedAt);
    return res;
  },
);
