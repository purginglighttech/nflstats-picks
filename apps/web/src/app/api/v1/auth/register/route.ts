import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import {
  ApiErrorException,
  ensureMinLatency,
  withApi,
} from "@/lib/api/with-api";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/cookies";
import { absoluteUrl, getEmailSender } from "@/lib/auth/email";
import { createSession } from "@/lib/auth/session";
import {
  DisplayNameTakenError,
  createUser,
  findUserByEmail,
  issueVerificationToken,
} from "@/lib/auth/users";

const budget = ROUTES_V1["/api/v1/auth/register"].POST.rateLimit;

/**
 * POST /api/v1/auth/register
 *
 * Account-enumeration protection: the response is identical whether the
 * email is new, already registered (verified or not), or the display name
 * collides — except a taken display name returns 409 display_name_taken,
 * which reveals nothing about email-account existence.
 */
export const POST = withApi(
  "auth:register",
  { auth: "none", body: v1.RegisterRequestSchema, rateLimit: budget },
  async (_req, ctx) => {
    const startedAt = Date.now();
    const { email, password, display_name } = ctx.body;
    const message =
      "If this email is new, an account was created and a verification link is on its way.";

    const existing = await findUserByEmail(email);
    if (existing) {
      // Enumeration-safe: same shape, same work profile. Re-issue the
      // verification link for unverified accounts (matches new-registration).
      if (!existing.emailVerified) {
        const issued = await issueVerificationToken(existing.id);
        await getEmailSender().sendVerificationEmail({
          to: existing.email,
          verifyUrl: absoluteUrl(`/verify?token=${issued.raw}`),
        });
      }
      await ensureMinLatency(startedAt);
      return NextResponse.json({ ok: true, message });
    }

    try {
      const user = await createUser({
        email,
        passwordHash: await hashPassword(password),
        displayName: display_name,
      });
      const issued = await issueVerificationToken(user.id);
      await getEmailSender().sendVerificationEmail({
        to: user.email,
        verifyUrl: absoluteUrl(`/verify?token=${issued.raw}`),
      });
      // Session rotation after authentication: brand-new account, fresh session.
      const session = await createSession(user.id);
      const res = NextResponse.json({ ok: true, message });
      setSessionCookie(res, session.token);
      await ensureMinLatency(startedAt);
      return res;
    } catch (err) {
      if (err instanceof DisplayNameTakenError) {
        await ensureMinLatency(startedAt);
        throw new ApiErrorException(409, "display_name_taken", err.message);
      }
      throw err;
    }
  },
);
