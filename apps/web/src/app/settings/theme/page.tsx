'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, getTeamFollows, putTeamFollows } from '@/lib/api';
import type { AccentSource, Luminance, TeamFollow } from '@/lib/types';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme/ThemeProvider';
import { TEAM_THEMES, getTeamTheme } from '@/lib/theme/teams';
import { EmptyState } from '@/components/EmptyState';

function teamLabel(teamId: string): string {
  const t = getTeamTheme(teamId);
  return t ? `${t.name} (${t.abbr})` : teamId;
}

/**
 * Theme & display settings (Phase 1): accent source, luminance, and the
 * fandom-hierarchy ordering that drives the team-derived accent.
 * Accent/luminance persist via PATCH /api/v1/me/settings (through the theme
 * context); the follow order persists via PUT /api/v1/me/team-follows.
 * Full drag reorder is Phase 8 — up/down controls here.
 */
export default function ThemeSettingsPage() {
  const { status } = useSession();
  const {
    accentSource,
    luminance,
    resolvedAccent,
    favoriteTeam,
    setAccentSource,
    setLuminance,
    themeError,
  } = useTheme();

  const [follows, setFollows] = useState<TeamFollow[]>([]);
  const [followsLoading, setFollowsLoading] = useState(true);
  const [followsError, setFollowsError] = useState<string | null>(null);
  const [addTeamId, setAddTeamId] = useState('');
  const [savingOrder, setSavingOrder] = useState(false);

  useEffect(() => {
    if (status !== 'signed-in') {
      setFollowsLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await getTeamFollows();
        if (!cancelled) {
          setFollows(
            list
              .filter((f) => f.active)
              .sort((a, b) => a.rank_position - b.rank_position),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setFollowsError(
            err instanceof ApiError ? err.message : 'Could not load followed teams.',
          );
        }
      } finally {
        if (!cancelled) setFollowsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  if (status === 'loading') {
    return <p role="status">Loading…</p>;
  }

  if (status === 'signed-out') {
    return (
      <EmptyState
        title="Sign in to manage theme settings"
        body="Accent and display preferences are per-member and persist across sessions and devices."
        action={
          <Link href="/signin?next=%2Fsettings%2Ftheme" className="btn btn-primary">
            Sign in
          </Link>
        }
      />
    );
  }

  const persistOrder = async (next: TeamFollow[]) => {
    setSavingOrder(true);
    setFollowsError(null);
    try {
      // Contracts: rank_position derives from array order; send team_id + active only.
      const { follows: updated } = await putTeamFollows({
        follows: next.map((f) => ({ team_id: f.team_id, active: f.active })),
      });
      setFollows(
        updated.filter((f) => f.active).sort((a, b) => a.rank_position - b.rank_position),
      );
    } catch (err) {
      setFollowsError(
        err instanceof ApiError ? err.message : 'Could not save the new order.',
      );
    } finally {
      setSavingOrder(false);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...follows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    setFollows(next);
    void persistOrder(next);
  };

  const removeFollow = (index: number) => {
    const next = follows.filter((_, i) => i !== index);
    setFollows(next);
    void persistOrder(next);
  };

  const addFollow = () => {
    if (!addTeamId) return;
    if (follows.some((f) => f.team_id === addTeamId)) {
      setFollowsError('That team is already in your hierarchy.');
      return;
    }
    const next = [...follows, { team_id: addTeamId, rank_position: follows.length + 1, active: true }];
    setFollows(next);
    setAddTeamId('');
    void persistOrder(next);
  };

  const unfollowedTeams = TEAM_THEMES.filter(
    (t) => !follows.some((f) => f.team_id === t.teamId),
  );

  const accentChoices: Array<{ value: AccentSource; title: string; blurb: string }> = [
    {
      value: 'team',
      title: 'Team colors',
      blurb: favoriteTeam
        ? `Accent follows your top-ranked team: ${teamLabel(favoriteTeam.team_id)}. Reordering the hierarchy changes it atomically.`
        : 'Accent follows your top-ranked followed team. Follow a team below to activate it.',
    },
    {
      value: 'neutral',
      title: 'Neutral',
      blurb: 'The product-brand default accent, independent of followed teams.',
    },
  ];

  const luminanceChoices: Array<{ value: Luminance; title: string; blurb: string }> = [
    { value: 'light', title: 'Light', blurb: 'Light surfaces, always.' },
    { value: 'dark', title: 'Dark', blurb: 'Dark surfaces, always.' },
    { value: 'system', title: 'System', blurb: 'Follow your operating system setting.' },
  ];

  return (
    <div className="max-w-xl">
      <h2 className="text-xl font-bold">Theme &amp; display</h2>
      <p className="field-hint mb-6">
        Accent carries team identity; luminance is your personal display
        preference and never depends on team identity.
      </p>

      {themeError ? (
        <p role="alert" className="form-error mb-4">
          {themeError}
        </p>
      ) : null}

      <fieldset className="mb-8">
        <legend className="field-label">Accent source</legend>
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Accent source">
          {accentChoices.map((c) => (
            <label key={c.value} className="radio-card">
              <input
                type="radio"
                name="accent-source"
                value={c.value}
                checked={accentSource === c.value}
                onChange={() => void setAccentSource(c.value)}
              />
              <span>
                <span className="block font-semibold">{c.title}</span>
                <span className="field-hint">{c.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="field-hint mt-3" aria-live="polite">
          Current accent: {resolvedAccent.name}
          <span
            aria-hidden="true"
            className="ml-2 inline-block h-4 w-4 rounded-full align-middle"
            style={{ background: 'var(--accent)' }}
          />
        </p>
      </fieldset>

      <fieldset className="mb-8">
        <legend className="field-label">Appearance</legend>
        <div className="flex flex-col gap-3" role="radiogroup" aria-label="Appearance">
          {luminanceChoices.map((c) => (
            <label key={c.value} className="radio-card">
              <input
                type="radio"
                name="luminance"
                value={c.value}
                checked={luminance === c.value}
                onChange={() => void setLuminance(c.value)}
              />
              <span>
                <span className="block font-semibold">{c.title}</span>
                <span className="field-hint">{c.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <section aria-labelledby="follow-order-heading" className="mb-8">
        <h3 id="follow-order-heading" className="field-label">
          Team follow order
        </h3>
        <p className="field-hint mb-4">
          Your fandom hierarchy. The top-ranked active team is the effective
          favorite for personalization — including the team-colors accent while
          that source is selected. No separate favorite field exists.
        </p>

        {followsLoading ? (
          <p role="status">Loading followed teams…</p>
        ) : followsError ? (
          <p role="alert" className="form-error">
            {followsError}
          </p>
        ) : follows.length === 0 ? (
          <EmptyState
            title="No followed teams yet"
            body="Follow teams below to build your hierarchy. Members with no followed teams see the neutral product-brand accent."
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {follows.map((f, i) => (
              <li
                key={f.team_id}
                className="card card-compact flex flex-wrap items-center gap-3"
              >
                <span
                  aria-hidden="true"
                  className="w-8 text-center font-bold"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 font-semibold">
                  {teamLabel(f.team_id)}
                  {i === 0 ? (
                    <span className="field-hint ml-2">effective favorite</span>
                  ) : null}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={i === 0 || savingOrder}
                    onClick={() => move(i, -1)}
                    aria-label={`Move ${teamLabel(f.team_id)} up`}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={i === follows.length - 1 || savingOrder}
                    onClick={() => move(i, 1)}
                    aria-label={`Move ${teamLabel(f.team_id)} down`}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={savingOrder}
                    onClick={() => removeFollow(i)}
                    aria-label={`Unfollow ${teamLabel(f.team_id)}`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="add-team" className="sr-only">
            Add a team to follow
          </label>
          <select
            id="add-team"
            className="select-input sm:flex-1"
            value={addTeamId}
            onChange={(e) => setAddTeamId(e.target.value)}
          >
            <option value="">Add a team…</option>
            {unfollowedTeams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!addTeamId || savingOrder}
            onClick={addFollow}
          >
            Follow team
          </button>
        </div>
        {savingOrder ? (
          <p role="status" className="field-hint mt-2">
            Saving order…
          </p>
        ) : null}
      </section>
    </div>
  );
}
