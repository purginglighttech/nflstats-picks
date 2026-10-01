'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getCurrentWeek, getWeekGames } from '@/lib/api';
import type { Game, Week } from '@/lib/types';
import { getTeamTheme } from '@/lib/theme/teams';

type BallotState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'scheduled'; week: Week; games: Game[] };

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
 * Protected ballot (Phase 1). Sibling C's middleware redirects signed-out
 * visitors to /signin?next=/picks; this page additionally handles a 401
 * defensively. With no games seeded (ingestion is Phase 2), the page shows
 * the designed empty state plus the quiet "0 games left to pick" count.
 * Pick controls arrive in Phase 3 — nothing here saves a pick.
 */
export default function PicksPage() {
  const [state, setState] = useState<BallotState>({ kind: 'loading' });

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
        const games = await getWeekGames(week.id);
        if (cancelled) return;
        if (games.length === 0) {
          setState({ kind: 'empty' });
        } else {
          setState({ kind: 'scheduled', week, games });
        }
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
        {/* Quiet completion count — present but zero until games exist. */}
        <p className="quiet-count" aria-live="polite" data-testid="games-left-count">
          {state.kind === 'scheduled'
            ? `${state.games.length} games left to pick`
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
              Schedule preview — pick controls arrive in a later phase. Nothing
              on this page saves a pick yet.
            </p>
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {state.games.map((game) => (
                <li key={game.id} className="card">
                  <p className="font-bold">
                    {teamName(game.away_team_id)}{' '}
                    <span style={{ color: 'var(--text-muted)' }} aria-hidden="true">
                      at
                    </span>{' '}
                    {teamName(game.home_team_id)}
                  </p>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {formatKickoff(game.kickoff_at)} · {game.status}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
