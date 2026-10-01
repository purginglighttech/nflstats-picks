import { NextResponse } from "next/server";
import { ROUTES_V1, v1 } from "@pickem/contracts";
import { ensureMinLatency, withApi } from "@/lib/api/with-api";
import { absoluteUrl, getEmailSender } from "@/lib/auth/email";
import { findUserByEmail, issuePasswordResetToken } from "@/lib/auth/users";

const budget = ROUTES_V1["/api/v1/auth/forgot-password"].POST.rateLimit;

/**
 * POST /api/v1/auth/forgot-password
 *
 * Always returns the identical success shape (and padded timing) whether or
 * not the email has an account — no account-enumeration signal.
 */
export const POST = withApi(
  "auth:forgot-password",
  { auth: "none", body: v1.ForgotPasswordRequestSchema, rateLimit: budget },
  async (_req, ctx) => {
    const startedAt = Date.now();

    const user = await findUserByEmail(ctx.body.email);
    if (user) {
      const issued = await issuePasswordResetToken(user.id);
      await getEmailSender().sendPasswordResetEmail({
        to: user.email,
        resetUrl: absoluteUrl(`/reset-password?token=${issued.raw}`),
      });
    }

    await ensureMinLatency(startedAt);
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, a reset link is on its way.",
    });
  },
);
