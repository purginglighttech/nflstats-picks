/**
 * Session cookie handling (spec: secure, httpOnly, same-site cookies).
 *
 * Server-only.
 */
import type { NextResponse } from "next/server";

export const SESSION_COOKIE_NAME = "pl_session";

/** 30 days in seconds — the session lifetime and the cookie Max-Age. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * `Secure` is set exactly when the deployment serves over HTTPS, detected
 * from APP_URL (e.g. "https://pickem.example.com"). Local dev over plain
 * http keeps the cookie working.
 */
export function isSecureContext(): boolean {
  return (process.env.APP_URL ?? "").toLowerCase().startsWith("https://");
}

/** Write the session cookie onto a response. */
export function setSessionCookie(
  response: NextResponse,
  token: string,
): void {
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Clear the session cookie (sign-out). */
export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    path: "/",
    maxAge: 0,
  });
}
