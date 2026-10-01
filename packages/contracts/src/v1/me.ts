/**
 * v1 "me" contracts: profile, settings (theme model), team follows,
 * notification preferences, push devices.
 */
import { z } from "zod";
import { DisplayNameSchema, EmailSchema } from "./auth.js";
import { EntityIdSchema, IsoDateTimeSchema, NflTeamSchema } from "./common.js";

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

/** GET /api/v1/me/profile */
export const ProfileSchema = z.object({
  id: EntityIdSchema,
  email: EmailSchema,
  display_name: DisplayNameSchema,
  email_verified: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type Profile = z.infer<typeof ProfileSchema>;

/** PATCH /api/v1/me/profile — email changes are out of scope for Phase 1. */
export const PatchProfileRequestSchema = z.object({
  display_name: DisplayNameSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
export type PatchProfileRequest = z.infer<typeof PatchProfileRequestSchema>;

/* ------------------------------------------------------------------ */
/* Settings — the theme model (spec section 21)                        */
/* ------------------------------------------------------------------ */

/**
 * Accent axis: "team" follows the fandom hierarchy's top-ranked active
 * follow (same derivation as the effective favorite); "neutral" uses the
 * product-brand default. Custom palettes are post-MVP (not in scope).
 */
export const AccentSourceSchema = z.enum(["team", "neutral"]);
export type AccentSource = z.infer<typeof AccentSourceSchema>;

/** Luminance axis: personal display preference, independent of team identity. */
export const LuminanceSchema = z.enum(["light", "dark", "system"]);
export type Luminance = z.infer<typeof LuminanceSchema>;

/** IANA timezone name, e.g. "America/Los_Angeles". Validated loosely in Phase 1. */
export const TimezoneSchema = z.string().min(1).max(64);
export type Timezone = z.infer<typeof TimezoneSchema>;

/** GET /api/v1/me/settings */
export const UserSettingsSchema = z.object({
  accent_source: AccentSourceSchema,
  luminance: LuminanceSchema,
  timezone: TimezoneSchema,
  updated_at: IsoDateTimeSchema,
});
export type UserSettings = z.infer<typeof UserSettingsSchema>;

/** PATCH /api/v1/me/settings — partial update; all fields optional. */
export const PatchUserSettingsRequestSchema = z.object({
  accent_source: AccentSourceSchema.optional(),
  luminance: LuminanceSchema.optional(),
  timezone: TimezoneSchema.optional(),
}).refine((v) => Object.keys(v).length > 0, { message: "Nothing to update." });
export type PatchUserSettingsRequest = z.infer<typeof PatchUserSettingsRequestSchema>;

/** Defaults mirror the user_settings table defaults (sibling B, 001_core.sql). */
export const DEFAULT_USER_SETTINGS = {
  accent_source: "team",
  luminance: "system",
  timezone: "America/Los_Angeles",
} satisfies Pick<UserSettings, "accent_source" | "luminance" | "timezone">;

/* ------------------------------------------------------------------ */
/* Team follows — ranked fandom hierarchy (spec: ranked follow hierarchy)*/
/* ------------------------------------------------------------------ */

/**
 * One follow. rank_position is 1-based; the top-ranked ACTIVE follow is the
 * effective favorite — there is no separate favorite-team field.
 *
 * `team_id` is the public team abbreviation (e.g. "KC"). The database stores
 * teams by uuid (sibling B, teams table); the server resolves abbreviation →
 * teams.id on write and back on read, so clients never see the uuid.
 */
export const TeamFollowSchema = z.object({
  team_id: NflTeamSchema,
  rank_position: z.number().int().min(1),
  active: z.boolean(),
});
export type TeamFollow = z.infer<typeof TeamFollowSchema>;

/** GET /api/v1/me/team-follows — ordered by rank_position ascending. */
export const TeamFollowsResponseSchema = z.object({
  follows: z.array(TeamFollowSchema),
});
export type TeamFollowsResponse = z.infer<typeof TeamFollowsResponseSchema>;

/**
 * PUT /api/v1/me/team-follows — replaces the whole hierarchy.
 * rank_position is derived from array order (first entry = 1).
 */
export const PutTeamFollowsRequestSchema = z.object({
  follows: z
    .array(
      z.object({
        team_id: NflTeamSchema,
        active: z.boolean().default(true),
      }),
    )
    .max(32, "Cannot follow more than 32 teams."),
}).refine(
  (v) => new Set(v.follows.map((f) => f.team_id)).size === v.follows.length,
  { message: "Duplicate team_id in follows." },
);
export type PutTeamFollowsRequest = z.infer<typeof PutTeamFollowsRequestSchema>;

/* ------------------------------------------------------------------ */
/* Notification preferences (spec: four separate alert controls)        */
/* ------------------------------------------------------------------ */

export const NotificationEventTypeSchema = z.enum([
  "team_news_published",
  "followed_team_game_started",
  "followed_team_game_final",
  "pick_standings_updated",
]);
export type NotificationEventType = z.infer<typeof NotificationEventTypeSchema>;

export const NotificationPreferenceSchema = z.object({
  event_type: NotificationEventTypeSchema,
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

/** GET /api/v1/me/notification-preferences — one row per event type. */
export const NotificationPreferencesResponseSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema).length(4),
});
export type NotificationPreferencesResponse = z.infer<typeof NotificationPreferencesResponseSchema>;

/** PATCH /api/v1/me/notification-preferences — upsert by event_type. */
export const PatchNotificationPreferencesRequestSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema).min(1).max(4),
}).refine(
  (v) => new Set(v.preferences.map((p) => p.event_type)).size === v.preferences.length,
  { message: "Duplicate event_type in preferences." },
);
export type PatchNotificationPreferencesRequest = z.infer<typeof PatchNotificationPreferencesRequestSchema>;

/* ------------------------------------------------------------------ */
/* Push devices (spec: tokens are sensitive operational data)           */
/* ------------------------------------------------------------------ */

/**
 * Platform values must match the push_devices.platform CHECK constraint
 * (sibling B, 004_notifications.sql): 'ios' | 'android'.
 */
export const PushPlatformSchema = z.enum(["ios", "android"]);
export type PushPlatform = z.infer<typeof PushPlatformSchema>;

/**
 * POST /api/v1/me/push-devices — registers a device. The raw provider token
 * is stored server-side for the notification worker and is never returned by
 * any endpoint; responses carry only the device id.
 */
export const RegisterPushDeviceRequestSchema = z.object({
  device_token: z.string().min(16, "Device token is missing or malformed.").max(512),
  platform: PushPlatformSchema,
  installation_id: z.string().min(1).max(128).optional(),
  app_version: z.string().min(1).max(32).optional(),
  locale: z.string().min(1).max(16).optional(),
});
export type RegisterPushDeviceRequest = z.infer<typeof RegisterPushDeviceRequestSchema>;

/** Push device as exposed by the API — token-free by design. */
export const PushDeviceSchema = z.object({
  id: EntityIdSchema,
  platform: PushPlatformSchema,
  created_at: IsoDateTimeSchema,
});
export type PushDevice = z.infer<typeof PushDeviceSchema>;

/** DELETE /api/v1/me/push-devices/[id] */
export const DeletePushDeviceParamsSchema = z.object({
  id: EntityIdSchema,
});
export type DeletePushDeviceParams = z.infer<typeof DeletePushDeviceParamsSchema>;
