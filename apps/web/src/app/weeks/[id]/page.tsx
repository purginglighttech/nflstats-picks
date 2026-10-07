'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getWeekGames, getWeeks } from '@/lib/api';
import type { Game, Week } from '@/lib/types';
import { getTeamTheme } from '@/lib/theme/teams';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; week: Week; games: Game[] };

function teamName(teamId: string): string {
  return getTeamTheme(teamId)?.name ?? teamId.toUpperCase();
}

function teamAbbr(teamId: string): string {
  return getTeamTheme(teamId)?.abbr ?? teamId.toUpperCase();
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

function statusLabel(status: string): string {
  switch (status) {
    case 'current':
      return 'Current week';
    case 'final':
      return 'Final';
    case 'upcoming':
      return 'Upcoming';
    default:
      return status;
  }
}

function gameStatusLabel(status: string): string {
  switch (status) {
    case 'scheduled':
      return 'Scheduled';
    case 'in_progress':
      return 'In progress';
    case 'final':
      return 'Final';
    default:
      return status;
  }
}

function scoreLine(game: Game): string {
  if (game.status === 'final' || game.status === 'in_progress') {
    return `${teamAbbr(game.away_team_id)} ${game.away_score ?? '–'} · ${teamAbbr(game.home_team_id)} ${game.home_score ?? '–'}`;
  }
  return `${teamName(game.away_team_id)} at ${teamName(game.home_team_id)}`;
}

/**
 * Week detail (Phase 2): the week's stable page. Full slate with kickoff
 * times and scores; every game card drills down to its canonical game page
 * at /games/[id], which serves all three life phases (scheduled preview,
 * in-progress, final report card).
 */
export default function WeekDetailPage() {
  const params = useParams<{ id: string }>();
  const ref = params.id;
  const [state, setState] = useState<DetailState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [weeks, games] = await Promise.all([
          getWeeks(),
          getWeekGames(ref),
        ]);
        const week =
          weeks.find((w) => w.id === ref) ??
          weeks.find((w) => String(w.week_number) === ref);
        if (!cancelled) {
          if (!week) setState({ kind: 'not-found' });
          else setState({ kind: 'ready', week, games });
        }
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setState({ kind: 'not-found' });
          } else {
            setState({
              kind: 'error',
              message:
                err instanceof ApiError ? err.message : 'Could not load the week.',
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ref]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <p role="status">Loading week…</p>
      </div>
    );
  }

  if (state.kind === 'error' || state.kind === 'not-found') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <p className="mb-4">
          <Link href="/weeks" className="link">
            ← All weeks
          </Link>
        </p>
        <div className="max-w-md">
          <EmptyState
            title={state.kind === 'not-found' ? 'Week not found' : 'Could not load the week'}
            body={
              state.kind === 'not-found'
                ? `No ingested week matches "${ref}".`
                : state.message
            }
          />
        </div>
      </div>
    );
  }

  const { week, games } = state;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-4">
        <Link href="/weeks" className="link">
          ← All weeks
        </Link>
      </p>
      <h1 className="text-3xl font-extrabold tracking-tight">{week.label}</h1>
      <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
        {week.season} season · {statusLabel(week.status)} · {games.length}{' '}
        {games.length === 1 ? 'game' : 'games'}
      </p>

      {games.length === 0 ? (
        <div className="mt-8 max-w-md">
          <EmptyState
            title="No games scheduled"
            body="This week has no games in the ingested schedule yet."
          />
        </div>
      ) : (
        <ol className="mt-8 grid max-w-4xl gap-3 md:grid-cols-2">
          {games.map((game) => (
            <li key={game.id}>
              <Link
                href={`/games/${game.id}`}
                className="card block p-4 no-underline"
                aria-label={`${scoreLine(game)}, ${gameStatusLabel(game.status)}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="font-bold">{scoreLine(game)}</span>
                  <span
                    className="shrink-0 text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {gameStatusLabel(game.status)}
                  </span>
                </span>
                <span
                  className="mt-1 block text-sm"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {formatKickoff(game.kickoff_at)} — tap for box score
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
