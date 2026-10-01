import { NextRequest, NextResponse } from "next/server";
import { AUTH_GATED_PATHS } from "@pickem/contracts";
import { SESSION_COOKIE_NAME } from "@/lib/auth/cookies";

/**
 * Make Picks handoff: unauthenticated visits to the authenticated app
 * surfaces redirect to /signin?next=<original path> so sign-in returns the
 * member to where they were headed (the ballot, standings, forum, …).
 *
 * This is a presence check only — the session cookie's existence. Real
 * authorization happens in the route handlers (`withApi` validates the
 * token against the sessions table). Middleware cannot reach Postgres from
 * the edge runtime.
 */
export function middleware(req: NextRequest): NextResponse {
  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);
  if (hasSession) return NextResponse.next();

  const next = req.nextUrl.pathname + req.nextUrl.search;
  const url = new URL("/signin", req.url);
  url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  // NOTE: Next.js statically analyzes this matcher, so it must be a string
  // array literal — it cannot be computed from AUTH_GATED_PATHS at module
  // scope. The assertion below fails fast at startup if the two drift apart.
  matcher: [
    "/picks/:path*",
    "/standings/:path*",
    "/compare/:path*",
    "/forum/:path*",
    "/settings/:path*",
  ],
};

// Fail fast if the static matcher above drifts from the canonical
// AUTH_GATED_PATHS in @pickem/contracts.
{
  const expected = [...AUTH_GATED_PATHS].map((p) => `${p}/:path*`).sort();
  const actual = [...config.matcher].sort();
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      `middleware matcher drifted from AUTH_GATED_PATHS: ` +
        `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}
