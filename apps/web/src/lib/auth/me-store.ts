/**
 * "Me" stores against sibling B's tables:
 *   user_settings(user_id PK, accent_source, luminance, timezone, updated_at)
 *   team_follows(id, user_id, team_id uuid -> teams, rank_position, active, ...)
 *   notification_preferences(id, user_id, event_type, enabled, ...)
 *   push_devices(id, user_id, platform, installation_id, provider_token,
 *                permission_state, app_version, locale, last_seen_at,
 *                invalidated_at, created_at, updated_at)
 *   teams(id, abbreviation UNIQUE, ...)
 *
 * Team identity on the wire is the uppercase abbreviation (e.g. "KC");
 * the DB keys teams by uuid, so this module resolves abbreviation ↔ uuid.
 * Raw provider tokens are write-only: no function here ever returns one.
 *
 * Server-only.
 */
import {
  query,
  queryOne,
  withTransaction,
} from "../db.js";
import type { v1 } from "@pickem/contracts";

type AccentSource = v1.AccentSource;
type Luminance = v1.Luminance;
type NotificationEventType = v1.NotificationEventType;
type NotificationPreference = v1.NotificationPreference;
type PushDevice = v1.PushDevice;
type PushPlatform = v1.PushPlatform;
type TeamFollow = v1.TeamFollow;
type Timezone = v1.Timezone;
type UserSettings = v1.UserSettings;

export interface SettingsPatch {
  accent_source?: AccentSource;
  luminance?: Luminance;
  timezone?: Timezone;
}

interface SettingsRow {
  accent_source: AccentSource;
  luminance: Luminance;
  timezone: string;
  updated_at: Date;
}

function toSettings(row: SettingsRow): UserSettings {
  return {
    accent_source: row.accent_source,
    luminance: row.luminance,
    timezone: row.timezone,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Read settings, creating the row with table defaults on first access. */
export async function getSettings(userId: string): Promise<UserSettings> {
  const existing = await queryOne<SettingsRow>(
    `SELECT accent_source, luminance, timezone, updated_at
     FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  if (existing) return toSettings(existing);
  const created = await queryOne<SettingsRow>(
    `INSERT INTO user_settings (user_id) VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING accent_source, luminance, timezone, updated_at`,
    [userId],
  );
  if (created) return toSettings(created);
  const raced = await queryOne<SettingsRow>(
    `SELECT accent_source, luminance, timezone, updated_at
     FROM user_settings WHERE user_id = $1`,
    [userId],
  );
  if (!raced) throw new Error("Failed to load user settings.");
  return toSettings(raced);
}

/** Partial settings update; creates the row with table defaults when missing. */
export async function updateSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const updated = await queryOne<SettingsRow>(
    `UPDATE user_settings SET
       accent_source = COALESCE($2, accent_source),
       luminance = COALESCE($3, luminance),
       timezone = COALESCE($4, timezone),
       updated_at = now()
     WHERE user_id = $1
     RETURNING accent_source, luminance, timezone, updated_at`,
    [userId, patch.accent_source ?? null, patch.luminance ?? null, patch.timezone ?? null],
  );
  if (updated) return toSettings(updated);

  // No row yet: insert, letting table defaults fill unspecified fields.
  const inserted = await queryOne<SettingsRow>(
    `INSERT INTO user_settings (user_id, accent_source, luminance, timezone)
     VALUES ($1, COALESCE($2, 'team'), COALESCE($3, 'system'),
             COALESCE($4, 'America/Los_Angeles'))
     ON CONFLICT (user_id) DO NOTHING
     RETURNING accent_source, luminance, timezone, updated_at`,
    [userId, patch.accent_source ?? null, patch.luminance ?? null, patch.timezone ?? null],
  );
  if (inserted) return toSettings(inserted);

  // Lost an insert race with a concurrent first write: retry the update.
  return getSettings(userId);
}

/* ------------------------------------------------------------------ */
/* Team follows                                                          */
/* ------------------------------------------------------------------ */

/** Thrown when a client-supplied abbreviation matches no seeded team. */
export class UnknownTeamError extends Error {
  constructor(abbr: string) {
    super(`Unknown team: ${abbr}.`);
    this.name = "UnknownTeamError";
  }
}

async function resolveTeamIds(abbreviations: string[]): Promise<Map<string, string>> {
  if (abbreviations.length === 0) return new Map();
  const rows = await query<{ id: string; abbreviation: string }>(
    `SELECT id, abbreviation FROM teams WHERE abbreviation = ANY($1)`,
    [abbreviations],
  );
  const map = new Map(rows.rows.map((r) => [r.abbreviation, r.id]));
  for (const abbr of abbreviations) {
    if (!map.has(abbr)) throw new UnknownTeamError(abbr);
  }
  return map;
}

/** Ranked hierarchy, rank_position ascending, abbreviations on the wire. */
export async function getTeamFollows(userId: string): Promise<TeamFollow[]> {
  const rows = await query<{
    abbreviation: string;
    rank_position: number;
    active: boolean;
  }>(
    `SELECT t.abbreviation, f.rank_position, f.active
     FROM team_follows f
     JOIN teams t ON t.id = f.team_id
     WHERE f.user_id = $1
     ORDER BY f.rank_position ASC`,
    [userId],
  );
  return rows.rows.map((r) => ({
    team_id: r.abbreviation as TeamFollow["team_id"],
    rank_position: r.rank_position,
    active: r.active,
  }));
}

/**
 * Replace the whole hierarchy atomically (delete + insert in one
 * transaction). rank_position derives from array order (first = 1).
 * Atomicity matters: the partial unique index on (user_id, rank_position)
 * WHERE active forbids piecemeal reorders.
 */
export async function replaceTeamFollows(
  userId: string,
  follows: Array<{ team_id: string; active: boolean }>,
): Promise<TeamFollow[]> {
  const ids = await resolveTeamIds(follows.map((f) => f.team_id));
  return withTransaction(async (client) => {
    await client.query(`DELETE FROM team_follows WHERE user_id = $1`, [userId]);
    for (const [index, follow] of follows.entries()) {
      await client.query(
        `INSERT INTO team_follows (user_id, team_id, rank_position, active)
         VALUES ($1, $2, $3, $4)`,
        [userId, ids.get(follow.team_id), index + 1, follow.active],
      );
    }
    const rows = (
      await client.query<{
        abbreviation: string;
        rank_position: number;
        active: boolean;
      }>(
        `SELECT t.abbreviation, f.rank_position, f.active
         FROM team_follows f
         JOIN teams t ON t.id = f.team_id
         WHERE f.user_id = $1
         ORDER BY f.rank_position ASC`,
        [userId],
      )
    ).rows;
    return rows.map((r) => ({
      team_id: r.abbreviation as TeamFollow["team_id"],
      rank_position: r.rank_position,
      active: r.active,
    }));
  });
}

/* ------------------------------------------------------------------ */
/* Notification preferences                                            */
/* ------------------------------------------------------------------ */

const ALL_EVENT_TYPES: NotificationEventType[] = [
  "team_news_published",
  "followed_team_game_started",
  "followed_team_game_final",
  "pick_standings_updated",
];

/** All four opt-ins; missing rows read as disabled (table default). */
export async function getNotificationPreferences(
  userId: string,
): Promise<NotificationPreference[]> {
  const rows = await query<{ event_type: string; enabled: boolean }>(
    `SELECT event_type, enabled FROM notification_preferences WHERE user_id = $1`,
    [userId],
  );
  const byType = new Map(rows.rows.map((r) => [r.event_type, r.enabled]));
  return ALL_EVENT_TYPES.map((event_type) => ({
    event_type,
    enabled: byType.get(event_type) ?? false,
  }));
}

/** Upsert opt-ins by event_type. */
export async function updateNotificationPreferences(
  userId: string,
  preferences: NotificationPreference[],
): Promise<NotificationPreference[]> {
  await withTransaction(async (client) => {
    for (const pref of preferences) {
      await client.query(
        `INSERT INTO notification_preferences (user_id, event_type, enabled)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, event_type) DO UPDATE SET
           enabled = EXCLUDED.enabled, updated_at = now()`,
        [userId, pref.event_type, pref.enabled],
      );
    }
  });
  return getNotificationPreferences(userId);
}

/* ------------------------------------------------------------------ */
/* Push devices (tokens are write-only)                                  */
/* ------------------------------------------------------------------ */

export interface PushDeviceInput {
  device_token: string;
  platform: PushPlatform;
  installation_id?: string;
  app_version?: string;
  locale?: string;
}

interface PushDeviceRow {
  id: string;
  platform: PushPlatform;
  created_at: Date;
}

function toPushDevice(row: PushDeviceRow): PushDevice {
  return {
    id: row.id,
    platform: row.platform,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * Register (or re-register) a device. Idempotent on (platform, token):
 * re-registration refreshes last_seen_at and clears any invalidation.
 * The raw token is stored for the notification worker; it is never returned.
 */
export async function registerPushDevice(
  userId: string,
  input: PushDeviceInput,
): Promise<PushDevice> {
  const row = await queryOne<PushDeviceRow>(
    `INSERT INTO push_devices
       (user_id, platform, installation_id, provider_token, app_version, locale,
        permission_state, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'unknown', now())
     ON CONFLICT (platform, provider_token) DO UPDATE SET
       user_id = EXCLUDED.user_id,
       installation_id = COALESCE(EXCLUDED.installation_id, push_devices.installation_id),
       app_version = COALESCE(EXCLUDED.app_version, push_devices.app_version),
       locale = COALESCE(EXCLUDED.locale, push_devices.locale),
       invalidated_at = NULL,
       last_seen_at = now(),
       updated_at = now()
     RETURNING id, platform, created_at`,
    [
      userId,
      input.platform,
      input.installation_id ?? null,
      input.device_token,
      input.app_version ?? null,
      input.locale ?? null,
    ],
  );
  if (!row) throw new Error("Failed to register push device.");
  return toPushDevice(row);
}

/** Invalidate one of the member's own devices (sets invalidated_at). */
export async function invalidatePushDevice(
  userId: string,
  deviceId: string,
): Promise<boolean> {
  const res = await query(
    `UPDATE push_devices SET invalidated_at = now(), updated_at = now()
     WHERE id = $1 AND user_id = $2 AND invalidated_at IS NULL`,
    [deviceId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Invalidate all of a member's devices (spec: on sign-out). */
export async function invalidateAllUserPushDevices(userId: string): Promise<void> {
  await query(
    `UPDATE push_devices SET invalidated_at = now(), updated_at = now()
     WHERE user_id = $1 AND invalidated_at IS NULL`,
    [userId],
  );
}

/** The member's live (non-invalidated) devices — token-free. */
export async function listPushDevices(userId: string): Promise<PushDevice[]> {
  const rows = await query<PushDeviceRow>(
    `SELECT id, platform, created_at FROM push_devices
     WHERE user_id = $1 AND invalidated_at IS NULL
     ORDER BY created_at DESC`,
    [userId],
  );
  return rows.rows.map(toPushDevice);
}
