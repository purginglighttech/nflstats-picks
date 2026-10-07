'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getCurrentWeek, getWeeks } from '@/lib/api';
import type { Week } from '@/lib/types';

type WeeksState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; weeks: Week[]; current: Week | null };

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

/**
 * Weekly Games index (Phase 2): every ingested week of the season, wired to
 * the sports-data read path. The current week is featured; each week card
 * links to its stable page at /weeks/[week-number].
 */
export default function WeeksPage() {
  const [state, setState] = useState<WeeksState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [weeks, current] = await Promise.all([getWeeks(), getCurrentWeek()]);
        if (!cancelled) setState({ kind: 'ready', weeks, current });
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message:
              err instanceof ApiError ? err.message : 'Could not load weeks.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Weekly Games</h1>
        <p role="status" className="mt-4">
          Loading weeks…
        </p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Weekly Games</h1>
        <div className="mt-8 max-w-md">
          <EmptyState title="Could not load weeks" body={state.message} />
        </div>
      </div>
    );
  }

  const { weeks, current } = state;

  if (weeks.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Weekly Games</h1>
        <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
          Every season week gets a stable page with the full slate, scores, and
          box-score drill-downs.
        </p>
        <div className="mt-8 max-w-md">
          <EmptyState
            title="No weeks scheduled yet"
            body="Once game data is ingested, this page lists the active week's complete slate. Past weeks remain available at their permanent addresses."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Weekly Games</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every season week gets a stable page with the full slate, scores, and
        box-score drill-downs.
      </p>

      {current ? (
        <section aria-label="Current week" className="mt-8">
          <h2 className="field-label">Current week</h2>
          <Link
            href={`/weeks/${current.week_number}`}
            className="card mt-2 block max-w-md p-5 no-underline"
          >
            <span className="text-xl font-bold">{current.label}</span>
            <span
              className="mt-1 block text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              {statusLabel(current.status)} · {current.season} season — tap for
              the full slate and scores
            </span>
          </Link>
        </section>
      ) : null}

      <section aria-label="All weeks" className="mt-10">
        <h2 className="field-label">All weeks</h2>
        <ol className="mt-2 grid max-w-3xl gap-3 sm:grid-cols-2">
          {weeks.map((week) => (
            <li key={week.id}>
              <Link
                href={`/weeks/${week.week_number}`}
                className="card block p-4 no-underline"
                aria-label={`${week.label}, ${statusLabel(week.status)}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-lg font-bold">{week.label}</span>
                  <span
                    className="text-sm"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {statusLabel(week.status)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
