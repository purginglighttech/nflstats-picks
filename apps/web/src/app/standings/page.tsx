'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import {
  ApiError,
  getCurrentWeek,
  getSeasonStandings,
  getWeeklyStandings,
  getWeeks,
} from '@/lib/api';
import type {
  SeasonStanding,
  Week,
  WeeklyStanding,
} from '@/lib/types';

type Tab = 'week' | 'season';

type StandingsState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      weeks: Week[];
      selectedWeekId: string;
      weekly: WeeklyStanding[];
      season: SeasonStanding[];
      seasonYear: number;
    };

function formatAccuracy(a: number | null): string {
  if (a === null) return '—';
  return `${(a * 100).toFixed(1)}%`;
}

function record(r: { wins: number; losses: number; ties: number }): string {
  return `${r.wins}–${r.losses}–${r.ties}`;
}

function StandingsTable({
  rows,
}: {
  rows: Array<{
    rank: number;
    display_name: string;
    wins: number;
    losses: number;
    ties: number;
    misses: number;
    accuracy: number | null;
    games_behind: number;
  }>;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No standings yet"
        body="Standings appear once games are graded. Check back after the week's games finish."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr style={{ color: 'var(--text-muted)' }}>
            <th scope="col" className="py-2 pr-4 font-semibold">Rank</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Participant</th>
            <th scope="col" className="py-2 pr-4 font-semibold">W–L–T</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Miss</th>
            <th scope="col" className="py-2 pr-4 font-semibold">Acc</th>
            <th scope="col" className="py-2 pr-4 font-semibold">GB</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.display_name} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="py-2 pr-4 font-bold">{r.rank}</td>
              <td className="py-2 pr-4 font-medium">{r.display_name}</td>
              <td className="py-2 pr-4 tabular-nums">{record(r)}</td>
              <td className="py-2 pr-4 tabular-nums" title="Locked games with no saved pick — a loss in standings, a miss on the ledger.">
                {r.misses}
              </td>
              <td className="py-2 pr-4 tabular-nums">{formatAccuracy(r.accuracy)}</td>
              <td className="py-2 pr-4 tabular-nums">{r.games_behind}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Standings (Phase 3, member-only via middleware). Weekly and season
 * leaderboards per spec decision #4: most correct picks, then accuracy,
 * then most completed eligible picks, then shared rank. A "Miss" (locked
 * with no saved pick) counts as a loss in standings but keeps its ledger
 * label — the Miss column shows it plainly instead of softening it.
 */
export default function StandingsPage() {
  const [tab, setTab] = useState<Tab>('week');
  const [state, setState] = useState<StandingsState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [weeks, current] = await Promise.all([getWeeks(), getCurrentWeek()]);
        if (cancelled) return;
        const selectedWeekId = current?.id ?? weeks[0]?.id;
        if (!selectedWeekId) {
          setState({
            kind: 'error',
            message: 'No weeks ingested yet — standings appear once games are graded.',
          });
          return;
        }
        const [weeklyRes, seasonRes] = await Promise.all([
          getWeeklyStandings(selectedWeekId),
          getSeasonStandings(String(current?.season ?? weeks[0]?.season ?? 2026)),
        ]);
        if (cancelled) return;
        setState({
          kind: 'ready',
          weeks,
          selectedWeekId,
          weekly: weeklyRes.standings,
          season: seasonRes.standings,
          seasonYear: seasonRes.season,
        });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          // Middleware redirects signed-out visitors; stay defensive.
          setState({ kind: 'error', message: 'Sign in to view standings.' });
        } else {
          setState({
            kind: 'error',
            message: 'Could not load standings. Please try again.',
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectWeek = async (weekId: string) => {
    if (state.kind !== 'ready' || weekId === state.selectedWeekId) return;
    try {
      const res = await getWeeklyStandings(weekId);
      setState({ ...state, selectedWeekId: weekId, weekly: res.standings });
    } catch {
      // Keep the previous week's table; the failure is transient.
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Standings</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Rank, record, accuracy, and games behind. A miss — a game that locked
        with no saved pick — counts as a loss, shown in its own column.
      </p>

      <div className="mt-6 flex gap-2" role="tablist" aria-label="Standings scope">
        {(
          [
            { id: 'week', label: 'This week' },
            { id: 'season', label: 'Season' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className="rounded-lg border px-4 py-2 font-semibold"
            style={
              tab === t.id
                ? {
                    background: 'var(--selected-fill)',
                    color: 'var(--selected-fill-text)',
                    borderColor: 'var(--selected-fill)',
                  }
                : { borderColor: 'var(--border)', color: 'var(--text)' }
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {state.kind === 'loading' ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Loading standings…
          </p>
        ) : state.kind === 'error' ? (
          <EmptyState title="Something went wrong" body={state.message} />
        ) : (
          <>
            {tab === 'week' && state.weeks.length > 1 && (
              <label className="mb-4 block text-sm" style={{ color: 'var(--text-muted)' }}>
                Week{' '}
                <select
                  value={state.selectedWeekId}
                  onChange={(e) => void selectWeek(e.target.value)}
                  className="rounded-lg border px-2 py-1"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                  }}
                >
                  {state.weeks.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {tab === 'week' ? (
              <StandingsTable rows={state.weekly} />
            ) : (
              <StandingsTable rows={state.season} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
