/**
 * Common primitives shared by every v1 contract.
 *
 * Pure TypeScript — no browser or Node-only imports.
 */
import { z } from "zod";

/** Uniform API failure envelope. Every v1 route returns this shape on error. */
export interface ApiError {
  error: {
    /** Machine-readable code, e.g. "invalid_credentials", "not_implemented". */
    code: string;
    /** Human-readable message safe to display. Never contains secrets or stack traces. */
    message: string;
  };
}

/** Uniform API success envelope for endpoints with no other payload. */
export interface ApiOk {
  ok: true;
  message: string;
}

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});

export const ApiOkSchema = z.object({
  ok: z.literal(true),
  message: z.string().min(1),
});

/** ISO-8601 UTC timestamp string. */
export const IsoDateTimeSchema = z.string().datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTimeSchema>;

/** Opaque entity identifiers. UUIDs for user-owned rows; provider ids for sports data. */
export const EntityIdSchema = z.string().min(1).max(64);
export type EntityId = z.infer<typeof EntityIdSchema>;

/** The 32 NFL club abbreviations. Canonical team identity across the platform. */
export const NFL_TEAMS = [
  "ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
  "HOU","IND","JAX","KC","LAC","LAR","LV","MIA","MIN","NE","NO","NYG",
  "NYJ","PHI","PIT","SEA","SF","TB","TEN","WAS",
] as const;

export type NflTeam = (typeof NFL_TEAMS)[number];

export const NflTeamSchema = z.enum(NFL_TEAMS);

/** Bounded pagination for list endpoints (stable pagination per spec). */
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(128).optional(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Error codes used across v1. Kept as a union for documentation; wire format is string. */
export const API_ERROR_CODES = [
  "invalid_request",
  "invalid_credentials",
  "unauthorized",
  "forbidden",
  "email_not_verified",
  "not_found",
  "rate_limited",
  "not_implemented",
  "internal_error",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
