'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import {
  ApiError,
  getCurrentWeek,
  getGamePicks,
  getWeekGames,
  getWeekPicks,
  savePick,
} from '@/lib/api';
import type {
  Game,
  Pick,
  PickRevealSummary,
  Week,
} from '@/lib/types';
import { getTeamTheme } from '@/lib/theme/teams';

type BallotState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | {
      kind: 'scheduled';
      week: Week;
      games: Game[];
      picks: Map<string, Pick>;
      reveals: Map<string, PickRevealSummary>;
    };

function teamName(teamId: string): string {
  return getTeamTheme(teamId)?.name ?? teamId.toUpperCase();
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Client-side locked-ness is informational: the server enforces the deadline
 * on every save and derives the reveal from lock_at on every read.
 */
function isLocked(game: Game): boolean {
  return Date.now() >= new Date(game.lock_at).getTime();
}

function isReveal(value: unknown): value is PickRevealSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { locked?: unknown }).locked === true
  );
}

/* ------------------------------------------------------------------ */
/* Game card                                                           */
/* ------------------------------------------------------------------ */

interface GameCardProps {
  game: Game;
  pick: Pick | undefined;
  reveal: PickRevealSummary | undefined;
  saving: boolean;
  saveError: string | null;
  onPick: (game: Game, teamId: string) => void;
}

function GameCard({ game, pick, reveal, saving, saveError, onPick }: GameCardProps) {
  const locked = isLocked(game);
  const pickedTeam = pick?.selected_team_id;

  return (
    <li
      className="card"
      data-testid={`game-card-${game.id}`}
      style={
        !locked && !pick
          ? // Unpicked: thin FIXED burnt-orange frame — the product-level
            // completion signal. This color never follows the member's theme
            // accent (direct user override).
            { border: '2px solid var(--frame-unpicked)' }
          : undefined
      }
    >
      <p className="font-bold">
        {teamName(game.away_team_id)}{' '}
        <span style={{ color: 'var(--text-muted)' }} aria-hidden="true">
          at
        </span>{' '}
        {teamName(game.home_team_id)}
      </p>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {formatKickoff(game.kickoff_at)} · {game.status}
        {locked ? ' · locked' : ''}
      </p>

      {!locked ? (
        <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={`Pick for ${teamName(game.away_team_id)} at ${teamName(game.home_team_id)}`}>
          {([game.away_team_id, game.home_team_id] as const).map((teamId) => {
            const selected = pickedTeam === teamId;
            return (
              <button
                key={teamId}
                type="button"
                disabled={saving}
                aria-pressed={selected}
                aria-label={`Pick ${teamName(teamId)}`}
                data-testid={`pick-${game.id}-${teamId}`}
                onClick={() => onPick(game, teamId)}
                className="rounded-lg border px-3 py-2 text-left font-semibold transition-colors"
                style={
                  selected
                    ? // Picked: solid filled row, theme-aware NEUTRAL fill.
                      // Never green/red — no correctness semantics.
                      {
                        background: 'var(--selected-fill)',
                        color: 'var(--selected-fill-text)',
                        borderColor: 'var(--selected-fill)',
                      }
                    : {
                        background: 'transparent',
                        color: 'var(--text)',
                        borderColor: 'var(--border)',
                      }
                }
              >
                <span className="flex items-center justify-between gap-2">
                  <span>{teamName(teamId)}</span>
                  {selected && (
                    <span aria-hidden="true" className="flex items-center gap-1 text-sm font-bold">
                      <span>✓</span>
                      <span>Pick</span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : reveal ? (
        <div className="mt-3 grid grid-cols-2 gap-2" aria-label="Locked picks">
          {reveal.teams.map((t) => (
            <a
              key={t.team_id}
              href={`/games/${game.id}/picks?team_id=${encodeURIComponent(t.team_id)}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid={`reveal-${game.id}-${t.team_id}`}
              className="rounded-lg border px-3 py-2 text-left"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              aria-label={`${teamName(t.team_id)}: ${t.pick_count} of ${reveal.eligible_participants} participants picked`}
            >
              <span className="block font-semibold">{teamName(t.team_id)}</span>
              <span className="block text-sm" style={{ color: 'var(--text-muted)' }}>
                {t.pick_count} of {reveal.eligible_participants} ·{' '}
                {Math.round(t.share * 100)}%
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          Locked — reveal unavailable.
        </p>
      )}

      {saveError && (
        <p className="mt-2 text-sm" role="alert" style={{ color: 'var(--danger)' }}>
          {saveError}
        </p>
      )}
      {saving && (
        <p className="mt-2 text-sm" role="status" style={{ color: 'var(--text-muted)' }}>
          Saving…
        </p>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PicksPage() {
  const [state, setState] = useState<BallotState>({ kind: 'loading' });
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const week = await getCurrentWeek();
        if (cancelled) return;
        if (!week) {
          setState({ kind: 'empty' });
          return;
        }
        const [games, picks] = await Promise.all([
          getWeekGames(week.id),
          getWeekPicks(week.id).catch((err) => {
            // A signed-out visitor is redirected by middleware, but stay
            // defensive: surface the sign-in state instead of an error.
            if (err instanceof ApiError && err.status === 401) throw err;
            // Picks failing must not hide the schedule.
            return [] as Pick[];
          }),
        ]);
        if (cancelled) return;
        if (games.length === 0) {
          setState({ kind: 'empty' });
          return;
        }
        const picksByGame = new Map(picks.map((p) => [p.game_id, p]));
        const reveals = new Map<string, PickRevealSummary>();
        await Promise.all(
          games
            .filter((g) => isLocked(g))
            .map(async (g) => {
              try {
                const res = await getGamePicks(g.id);
                if (isReveal(res)) reveals.set(g.id, res);
              } catch {
                // A reveal failing must not hide the ballot.
              }
            }),
        );
        if (cancelled) return;
        setState({ kind: 'scheduled', week, games, picks: picksByGame, reveals });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'signed-out' });
        } else {
          setState({
            kind: 'error',
            message: 'Could not load the ballot. Please try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = useCallback(
    async (game: Game, teamId: string) => {
      if (state.kind !== 'scheduled') return;
      if (state.picks.get(game.id)?.selected_team_id === teamId) return;
      setSaving((prev) => new Set(prev).add(game.id));
      setSaveErrors((prev) => {
        const next = new Map(prev);
        next.delete(game.id);
        return next;
      });
      try {
        const pick = await savePick(game.id, teamId);
        setState((prev) => {
          if (prev.kind !== 'scheduled') return prev;
          const picks = new Map(prev.picks);
          picks.set(game.id, pick);
          return { ...prev, picks };
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409 && err.code === 'pick_locked') {
          // The deadline passed mid-tap: mark the game locked and pull the
          // server-authoritative reveal so the card flips to the locked state.
          setSaveErrors((prev) =>
            new Map(prev).set(game.id, 'Just locked — picks are closed for this game.'),
          );
          try {
            const res = await getGamePicks(game.id);
            if (isReveal(res)) {
              setState((prev) => {
                if (prev.kind !== 'scheduled') return prev;
                const reveals = new Map(prev.reveals);
                reveals.set(game.id, res);
                return { ...prev, reveals };
              });
            }
          } catch {
            // Reveal fetch failed; the locked state still renders from lock_at.
          }
        } else if (err instanceof ApiError && err.status === 403 && err.code === 'not_pool_member') {
          setSaveErrors((prev) =>
            new Map(prev).set(game.id, 'Only competition pool members can save picks.'),
          );
        } else if (err instanceof ApiError && err.status === 403 && err.code === 'email_not_verified') {
          setSaveErrors((prev) =>
            new Map(prev).set(game.id, 'Verify your email address to save picks.'),
          );
        } else {
          // Rejected saves remain visibly unsuccessful; prior state is kept.
          setSaveErrors((prev) =>
            new Map(prev).set(game.id, 'Could not save that pick. Please try again.'),
          );
        }
      } finally {
        setSaving((prev) => {
          const next = new Set(prev);
          next.delete(game.id);
          return next;
        });
      }
    },
    [state],
  );

  const gamesLeft =
    state.kind === 'scheduled'
      ? state.games.filter((g) => !isLocked(g) && !state.picks.has(g.id)).length
      : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Make Picks</h1>
          <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
            The current week&apos;s ballot. Games lock automatically five
            minutes before kickoff.
          </p>
        </div>
        <p className="quiet-count" aria-live="polite" data-testid="games-left-count">
          {state.kind === 'scheduled'
            ? `${gamesLeft} ${gamesLeft === 1 ? 'game' : 'games'} left to pick`
            : '0 games left to pick'}
        </p>
      </div>

      <div className="mt-8">
        {state.kind === 'loading' ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Loading the ballot…
          </p>
        ) : state.kind === 'signed-out' ? (
          <EmptyState
            title="Sign in to make picks"
            body="The ballot is for authenticated participants. Sign in and you'll return straight here."
            action={
              <Link href="/signin?next=%2Fpicks" className="btn btn-primary">
                Sign in
              </Link>
            }
          />
        ) : state.kind === 'error' ? (
          <EmptyState title="Something went wrong" body={state.message} />
        ) : state.kind === 'empty' ? (
          <EmptyState
            title="No games scheduled yet"
            body="No games scheduled yet — check back soon. The ballot appears here automatically once the week's slate is ingested."
          />
        ) : (
          <section aria-labelledby="ballot-games-heading">
            <h2 id="ballot-games-heading" className="sr-only">
              {state.week.label} games
            </h2>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              Tap a team to pick it. You can change a pick until the game
              locks — nothing locks when you save.
            </p>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {state.games.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  pick={state.picks.get(game.id)}
                  reveal={state.reveals.get(game.id)}
                  saving={saving.has(game.id)}
                  saveError={saveErrors.get(game.id) ?? null}
                  onPick={handlePick}
                />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
