/**
 * v1 route manifest: path -> method -> contract spec.
 *
 * The single source of truth for the versioned API surface. The web app's
 * `withApi` wrapper consumes these specs (validation schemas, auth
 * requirement, rate-limit budget); the future React Native client consumes
 * the same file for typed request construction.
 *
 * Rate-limit budgets are token-bucket: `capacity` burst tokens, refilled at
 * `refillPerSecond`. Auth endpoints are deliberately tight per the spec's
 * fair-play / security rate-limit list.
 */
import { z } from "zod";
import {
  ForgotPasswordRequestSchema,
  RegisterRequestSchema,
  ResetPasswordRequestSchema,
  SigninRequestSchema,
  VerifyEmailQuerySchema,
} from "./auth.js";
import { ApiErrorSchema, ApiOkSchema } from "./common.js";
import {
  DeletePushDeviceParamsSchema,
  PatchNotificationPreferencesRequestSchema,
  PatchProfileRequestSchema,
  PatchUserSettingsRequestSchema,
  PutTeamFollowsRequestSchema,
  RegisterPushDeviceRequestSchema,
} from "./me.js";
import {
  BallotScheduleResponseSchema,
  SavePickParamsSchema,
  SavePickRequestSchema,
  WeeklyStandingsResponseSchema,
} from "./competition.js";

export interface RateLimitBudget {
  /** Burst capacity in tokens. */
  capacity: number;
  /** Sustained refill rate in tokens per second. */
  refillPerSecond: number;
}

export interface RouteSpec {
  /** "none" = public; "session" = requires a valid session cookie. */
  auth: "none" | "session";
  /** Token-bucket budget keyed per IP + route. Omitted = no limit. */
  rateLimit?: RateLimitBudget;
  body?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  /** Human-readable purpose; mirrors the spec's endpoint table. */
  description: string;
}

/** Requests per 10 minutes expressed as a token bucket. */
const per10m = (n: number): RateLimitBudget => ({ capacity: n, refillPerSecond: n / 600 });
/** Requests per hour expressed as a token bucket. */
const perHour = (n: number): RateLimitBudget => ({ capacity: n, refillPerSecond: n / 3600 });

export const ROUTES_V1: Record<string, Record<string, RouteSpec>> = {
  "/api/v1/auth/register": {
    POST: {
      auth: "none",
      rateLimit: perHour(10),
      body: RegisterRequestSchema,
      description:
        "Create an account. Always returns the identical success shape to prevent account enumeration.",
    },
  },
  "/api/v1/auth/signin": {
    POST: {
      auth: "none",
      rateLimit: per10m(20),
      body: SigninRequestSchema,
      description:
        "Authenticate. Rotates the session; wrong-password and unknown-email return identical 401s.",
    },
  },
  "/api/v1/auth/signout": {
    POST: {
      auth: "session",
      description: "Revoke the current session, clear the cookie, invalidate push devices.",
    },
  },
  "/api/v1/auth/verify": {
    GET: {
      auth: "none",
      rateLimit: perHour(30),
      query: VerifyEmailQuerySchema,
      description: "Consume an email-verification token; rotates the session when one exists.",
    },
  },
  "/api/v1/auth/forgot-password": {
    POST: {
      auth: "none",
      rateLimit: perHour(10),
      body: ForgotPasswordRequestSchema,
      description:
        "Request a password-reset email. Always returns the identical success shape.",
    },
  },
  "/api/v1/auth/reset-password": {
    POST: {
      auth: "none",
      rateLimit: perHour(10),
      body: ResetPasswordRequestSchema,
      description:
        "Consume a reset token, set a new password, revoke all sessions, start a fresh one.",
    },
  },
  "/api/v1/auth/me": {
    GET: {
      auth: "session",
      description: "Current session's account identity.",
    },
  },
  "/api/v1/me/profile": {
    GET: { auth: "session", description: "Read own profile." },
    PATCH: {
      auth: "session",
      body: PatchProfileRequestSchema,
      description: "Update display name. Email changes are out of scope for Phase 1.",
    },
  },
  "/api/v1/me/settings": {
    GET: { auth: "session", description: "Read theme settings (accent_source, luminance, timezone)." },
    PATCH: {
      auth: "session",
      body: PatchUserSettingsRequestSchema,
      description: "Partial settings update; creates the row with defaults on first write.",
    },
  },
  "/api/v1/me/team-follows": {
    GET: { auth: "session", description: "Ranked fandom hierarchy, rank_position order." },
    PUT: {
      auth: "session",
      body: PutTeamFollowsRequestSchema,
      description: "Replace the whole hierarchy; rank_position derives from array order.",
    },
  },
  "/api/v1/me/notification-preferences": {
    GET: { auth: "session", description: "Four explicit alert opt-ins." },
    PATCH: {
      auth: "session",
      body: PatchNotificationPreferencesRequestSchema,
      description: "Upsert opt-ins by event_type.",
    },
  },
  "/api/v1/me/push-devices": {
    POST: {
      auth: "session",
      body: RegisterPushDeviceRequestSchema,
      description: "Register a push device. Raw tokens are never returned by any endpoint.",
    },
  },
  "/api/v1/me/push-devices/[id]": {
    DELETE: {
      auth: "session",
      params: DeletePushDeviceParamsSchema,
      description: "Invalidate (revoke) one of the member's own devices.",
    },
  },
  "/api/v1/weeks/current": {
    GET: {
      auth: "none",
      description: "Resolve the active weekly page. Phase 1: 501 not_implemented (no sports data seeded).",
    },
  },
  "/api/v1/weeks/[id]/games": {
    GET: {
      auth: "none",
      params: z.object({ id: z.string().min(1).max(64) }),
      description: "Ballot schedule for a week. Phase 1: 200 with an empty games array.",
      // Response shape reference:
      // (kept as a comment to avoid a runtime schema dependency cycle)
    },
  },
  "/api/v1/weeks/[id]/standings": {
    GET: {
      auth: "none",
      params: z.object({ id: z.string().min(1).max(64) }),
      description: "Weekly ranking. Phase 1: 501 not_implemented (scoring lands in Phase 3+).",
    },
  },
  "/api/v1/games/[id]/pick": {
    PUT: {
      auth: "session",
      params: SavePickParamsSchema,
      body: SavePickRequestSchema,
      rateLimit: per10m(120),
      description:
        "Save or revise a pick. Phase 1: auth + validation + game-exists check run; the write itself returns 501 not_implemented until Phase 3.",
    },
  },
};

/** Paths the auth middleware guards: unauthenticated visits redirect to /signin?next=. */
export const AUTH_GATED_PATHS = ["/picks", "/standings", "/compare", "/forum", "/settings"] as const;

/** Keep the manifest honest: every route documents its failure envelope. */
export const V1_FAILURE_ENVELOPE = ApiErrorSchema;
export const V1_OK_ENVELOPE = ApiOkSchema;

// Re-export the response shapes referenced by the manifest comments above so
// consumers can import them from one place.
export { BallotScheduleResponseSchema, WeeklyStandingsResponseSchema };
export type { RouteSpec as V1RouteSpec, RateLimitBudget as V1RateLimitBudget };
