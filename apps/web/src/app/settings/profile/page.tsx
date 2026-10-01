'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, getSettings, patchProfile, patchSettings } from '@/lib/api';
import { useSession } from '@/lib/session';
import { EmptyState } from '@/components/EmptyState';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

/**
 * Profile settings (Phase 1): display name + timezone.
 *
 * Contracts split the two fields: display name persists via
 * PATCH /api/v1/me/profile, timezone via PATCH /api/v1/me/settings
 * (sibling C). The form saves both and reports honestly if only one lands.
 */
export default function ProfileSettingsPage() {
  const { status, me, refresh } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status !== 'signed-in') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const settings = await getSettings();
        if (!cancelled) setTimezone(settings.timezone ?? '');
      } catch {
        if (!cancelled) setTimezone('');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (me) setDisplayName(me.display_name);
  }, [me]);

  if (status === 'loading' || loading) {
    return <p role="status">Loading…</p>;
  }

  if (status === 'signed-out') {
    return (
      <EmptyState
        title="Sign in to manage settings"
        body="Profile settings are for members."
        action={
          <Link href="/signin?next=%2Fsettings%2Fprofile" className="btn btn-primary">
            Sign in
          </Link>
        }
      />
    );
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const name = displayName.trim();
    if (name.length === 0) {
      setError('Display name cannot be empty.');
      return;
    }
    setSaving(true);
    try {
      // Two contract endpoints; each failure is reported on its own.
      await patchProfile({ display_name: name });
      if (timezone) {
        await patchSettings({ timezone });
      }
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Could not save profile. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-xl" aria-describedby="profile-form-hint">
      <h2 className="text-xl font-bold">Profile</h2>
      <p id="profile-form-hint" className="field-hint mb-6">
        Your display name is public. Your email is never public.
      </p>

      <div className="mb-5">
        <label htmlFor="display-name" className="field-label">
          Display name
        </label>
        <input
          id="display-name"
          type="text"
          className="text-input"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={40}
          autoComplete="nickname"
          required
        />
      </div>

      <div className="mb-6">
        <label htmlFor="timezone" className="field-label">
          Timezone
        </label>
        <select
          id="timezone"
          className="select-input"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          <option value="">Use my device timezone</option>
          {TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace('_', ' ')}
            </option>
          ))}
        </select>
        <p className="field-hint">
          Kickoff times and deadlines display in this timezone. Stored with
          your theme settings.
        </p>
      </div>

      {error ? (
        <p role="alert" className="form-error mb-4">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="form-ok mb-4">
          Profile saved.
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={saving}>
        {saving ? 'Saving…' : 'Save profile'}
      </button>
    </form>
  );
}
