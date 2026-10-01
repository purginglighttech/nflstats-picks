/**
 * `withApi` — the wrapper every v1 route handler goes through.
 *
 * Responsibilities:
 * - zod validation of body / query / params (400 invalid_request on failure)
 * - session extraction from the session cookie (401 when required and missing/invalid)
 * - per-IP + route token-bucket rate limiting (429 rate_limited)
 * - uniform `{ error: { code, message } }` failures; no stack traces to clients
 * - server-side logging of unexpected failures without request bodies/secrets
 *
 * Also exports `requireVerified()` for Phase 3+ (the verified-email gate is
 * NOT enforced in Phase 1) and `safeNextPath()` for post-auth redirects.
 *
 * Server-only.
 */
import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { SESSION_COOKIE_NAME } from "../auth/cookies.js";
import { validateSessionToken } from "../auth/session.js";

/* ------------------------------------------------------------------ */
/* Errors                                                                */
/* ------------------------------------------------------------------ */

/** Throw inside a handler to return a uniform API error. */
export class ApiErrorException extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiErrorException";
    this.status = status;
    this.code = code;
  }
}

export function unauthorized(message = "Sign in required."): ApiErrorException {
  return new ApiErrorException(401, "unauthorized", message);
}

export function notFound(message = "Not found."): ApiErrorException {
  return new ApiErrorException(404, "not_found", message);
}

function errorResponse(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

/* ------------------------------------------------------------------ */
/* Rate limiting: in-memory token bucket per IP + route                  */
/* ------------------------------------------------------------------ */

export interface RateLimitBudget {
  capacity: number;
  refillPerSecond: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

function sweepBuckets(now: number): void {
  if (buckets.size <= MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.lastRefillMs > 3_600_000) buckets.delete(key);
    if (buckets.size <= MAX_BUCKETS) break;
  }
}

/** Consume one token; false when the bucket is empty. */
export function checkRateLimit(key: string, budget: RateLimitBudget): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: budget.capacity, lastRefillMs: now };
    buckets.set(key, bucket);
  }
  const elapsedSec = (now - bucket.lastRefillMs) / 1000;
  bucket.tokens = Math.min(
    budget.capacity,
    bucket.tokens + elapsedSec * budget.refillPerSecond,
  );
  bucket.lastRefillMs = now;
  sweepBuckets(now);
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/**
 * NOTE: the bucket lives in process memory. Behind multiple instances or
 * serverless concurrency, each instance enforces its own budget. A shared
 * (Redis/DB-backed) limiter replaces this when horizontal scale arrives.
 */

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

/* ------------------------------------------------------------------ */
/* Verified-email gate (Phase 3+; exported now, not enforced in Phase 1) */
/* ------------------------------------------------------------------ */

/**
 * Require a verified email before the caller proceeds. Phase 1 exports this
 * for Phase 3+ (picks affecting standings, forum access); no Phase-1 route
 * calls it yet.
 */
export function requireVerified(user: { emailVerified: boolean } | null): void {
  if (!user || !user.emailVerified) {
    throw new ApiErrorException(
      403,
      "email_not_verified",
      "Verify your email address to continue.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* safeNextPath — same-origin redirect targets only                     */
/* ------------------------------------------------------------------ */

/**
 * Validate a `?next=` value: must be a same-origin absolute path.
 * Rejects protocol-relative URLs, backslashes, schemes, and control chars.
 */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return null;
  }
  if (
    !decoded.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(decoded) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(decoded)
  ) {
    return null;
  }
  return decoded;
}

/* ------------------------------------------------------------------ */
/* Uniform timing for enumeration-safe endpoints                         */
/* ------------------------------------------------------------------ */

/**
 * Pad an auth response to a minimum latency so success/failure shapes for
 * register / sign-in / forgot-password don't leak account existence through
 * timing. Combined with the dummy argon2 verify for unknown emails.
 */
export async function ensureMinLatency(startedAtMs: number, minMs = 300): Promise<void> {
  const elapsed = Date.now() - startedAtMs;
  if (elapsed < minMs) {
    await new Promise((resolve) => setTimeout(resolve, minMs - elapsed));
  }
}

/* ------------------------------------------------------------------ */
/* withApi                                                               */
/* ------------------------------------------------------------------ */

export interface ApiSession {
  sessionId: string;
  userId: string;
}

export interface ApiContext {
  session: ApiSession | null;
  ip: string;
}

export interface WithApiOptions {
  auth?: "none" | "session";
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  rateLimit?: RateLimitBudget;
}

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined;

export interface RouteContext {
  // Required (not optional): Next 15's route-type validation rejects an
  // optional params — the framework always supplies the object.
  params: Promise<Record<string, string | string[] | undefined>>;
}

export function withApi<
  S extends { body?: z.ZodTypeAny; query?: z.ZodTypeAny; params?: z.ZodTypeAny },
>(
  routeKey: string,
  options: WithApiOptions & S,
  handler: (
    req: NextRequest,
    ctx: ApiContext & {
      body: Infer<S["body"]>;
      query: Infer<S["query"]>;
      params: Infer<S["params"]>;
    },
  ) => Promise<NextResponse> | NextResponse,
): (req: NextRequest, routeCtx: RouteContext) => Promise<NextResponse> {
  return async (req: NextRequest, routeCtx: RouteContext) => {
    try {
      const ip = getClientIp(req);

      if (options.rateLimit) {
        if (!checkRateLimit(`${ip}:${routeKey}`, options.rateLimit)) {
          return errorResponse(
            429,
            "rate_limited",
            "Too many requests. Please try again later.",
          );
        }
      }

      let session: ApiSession | null = null;
      if (options.auth === "session") {
        const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
        const record = await validateSessionToken(token);
        if (!record) throw unauthorized();
        session = { sessionId: record.id, userId: record.userId };
      }

      let body: unknown;
      if (options.body) {
        const contentType = req.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          try {
            body = await req.json();
          } catch {
            throw new ApiErrorException(
              400,
              "invalid_request",
              "Request body must be valid JSON.",
            );
          }
        } else if (req.method !== "GET" && req.method !== "HEAD") {
          // A body schema with no JSON body is a client error, not a crash.
          body = undefined;
        }
        body = options.body.parse(body);
      }

      let query: unknown;
      if (options.query) {
        query = options.query.parse(
          Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
      }

      let params: unknown;
      if (options.params) {
        const raw = (await routeCtx?.params) ?? {};
        params = options.params.parse(raw);
      }

      return await handler(req, {
        session,
        ip,
        body: body as Infer<S["body"]>,
        query: query as Infer<S["query"]>,
        params: params as Infer<S["params"]>,
      });
    } catch (err) {
      if (err instanceof ApiErrorException) {
        return errorResponse(err.status, err.code, err.message);
      }
      if (err instanceof ZodError) {
        const first = err.issues[0];
        const where = first && first.path.length > 0 ? ` (${first.path.join(".")})` : "";
        return errorResponse(
          400,
          "invalid_request",
          `Invalid request${where}: ${first?.message ?? "validation failed"}.`,
        );
      }
      // Unexpected: log the route + message server-side only. Never echo
      // request bodies (they may contain passwords) or stack traces.
      console.error(
        `[api] ${routeKey} unexpected error:`,
        err instanceof Error ? err.message : String(err),
      );
      return errorResponse(500, "internal_error", "Something went wrong.");
    }
  };
}
