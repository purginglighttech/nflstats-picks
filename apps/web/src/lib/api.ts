/**
 * Typed fetch wrappers for the versioned API (sibling C: /api/v1/*).
 * All requests are same-origin and send cookies for session auth.
 *
 * Error envelope (contracts v1/common.ts ApiErrorSchema):
 *   { error: { code: string, message: string } }
 */
import type {
  Game,
  Me,
  MemberSettings,
  Profile,
  ProfilePatch,
  SettingsPatch,
  TeamFollow,
  TeamFollowOrderUpdate,
  Week,
} from './types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    let code: string | null = null;
    let message = `Request failed (${res.status})`;
    if (typeof body === 'object' && body !== null && 'error' in body) {
      const err = (body as { error: unknown }).error;
      if (typeof err === 'object' && err !== null) {
        const rec = err as Record<string, unknown>;
        if (typeof rec.code === 'string') code = rec.code;
        if (typeof rec.message === 'string') message = rec.message;
      }
    }
    throw new ApiError(res.status, code, message);
  }
  return body as T;
}

const get = <T>(path: string) => request<T>(path, { method: 'GET' });

/**
 * Signed-in member identity. Contracts: GET /api/v1/auth/me -> { user }.
 * Throws ApiError(401) when signed out.
 */
export async function getMe(): Promise<Me> {
  const body = await get<{ user: Me }>('/auth/me');
  return body.user;
}

/** Member's own profile. Contracts: GET /api/v1/me/profile -> { profile }. */
export async function getProfile(): Promise<Profile> {
  const body = await get<{ profile: Profile }>('/me/profile');
  return body.profile;
}

/**
 * Update display name. Contracts: PATCH /api/v1/me/profile accepts
 * display_name ONLY (email changes out of scope; timezone is a setting)
 * -> { profile }.
 */
export async function patchProfile(patch: ProfilePatch): Promise<Profile> {
  const body = await request<{ profile: Profile }>('/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.profile;
}

/**
 * Theme + timezone settings. Contracts: GET /api/v1/me/settings
 * -> { settings: { accent_source, luminance, timezone, updated_at } }.
 */
export async function getSettings(): Promise<MemberSettings> {
  const body = await get<{ settings: MemberSettings }>('/me/settings');
  return body.settings;
}

export async function patchSettings(patch: SettingsPatch): Promise<MemberSettings> {
  const body = await request<{ settings: MemberSettings }>('/me/settings', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
  return body.settings;
}

/**
 * Ranked fandom hierarchy. Contracts: GET /api/v1/me/team-follows
 * -> { follows: TeamFollow[] }, ordered by rank_position ascending.
 */
export async function getTeamFollows(): Promise<TeamFollow[]> {
  const body = await get<{ follows: TeamFollow[] }>('/me/team-follows');
  return body.follows;
}

/**
 * Replace the whole hierarchy. Contracts: PUT /api/v1/me/team-follows with
 * { follows: [{ team_id, active }] } — rank_position derives from array
 * order (first entry = 1).
 */
export const putTeamFollows = (update: TeamFollowOrderUpdate) =>
  request<{ follows: TeamFollow[] }>('/me/team-follows', {
    method: 'PUT',
    body: JSON.stringify(update),
  });

/**
 * Current week. Normalizes the response: sibling C may return the week
 * object directly, `{ week }`, or null. The route manifest marks this
 * 501 not_implemented for Phase 1 (no sports data seeded) — treated the
 * same as "no active week" so the ballot renders its empty state.
 */
export async function getCurrentWeek(): Promise<Week | null> {
  try {
    const body = await get<Week | { week: Week | null } | null>('/weeks/current');
    if (body === null) return null;
    if (typeof body === 'object' && 'week' in body) return body.week;
    return body;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
      return null;
    }
    throw err;
  }
}

/**
 * Games for a week. Contracts: GET /api/v1/weeks/[id]/games
 * -> { week_id, games: Game[] } (Phase 1: 200 with an empty games array).
 */
export async function getWeekGames(weekId: string): Promise<Game[]> {
  const body = await get<{ week_id: string; games: Game[] } | Game[]>(
    `/weeks/${encodeURIComponent(weekId)}/games`,
  );
  if (Array.isArray(body)) return body;
  return body.games ?? [];
}

/** Contracts: POST /api/v1/auth/signout (session auth; revokes + clears cookie). */
export async function signOut(): Promise<void> {
  const res = await fetch('/api/v1/auth/signout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) throw new ApiError(res.status, null, 'Sign out failed');
}
