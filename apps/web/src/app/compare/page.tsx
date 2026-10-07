'use client';

import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import {
  ApiError,
  getHeadToHead,
  getSeasonStandings,
  getWeeks,
} from '@/lib/api';
import type {
  HeadToHeadGame,
  HeadToHeadResponse,
  SeasonStanding,
  Week,
} from '@/lib/types';

type Scope = { kind: 'week'; weekId: string } | { kind: 'season'; season: number };

type CompareState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | {
      kind: 'ready';
      participants: SeasonStanding[];
      weeks: Week[];
      seasonYear: number;
      userA: string;
      userB: string;
      scope: Scope;
      data: HeadToHeadResponse | null;
      dataState: 'idle' | 'loading' | 'error';
      dataError: string | null;
    };

function gradeBadge(grade: HeadToHeadGame['user_a_grade']): string {
  switch (grade) {
    case 'win': return '✓';
    case 'loss': return '✗';
    case 'tie': return '=';
    default: return '–';
  }
}

function CompareTable({ data }: { data: HeadToHeadResponse }) {
  const { user_a, user_b, games, summary } = data;
  const aAhead = summary.user_a_disagreement_wins > summary.user_b_disagreement_wins;
  const bAhead = summary.user_b_disagreement_wins > summary.user_a_disagreement_wins;

  return (
    <div className="mt-6">
      <div className="grid grid-cols-3 gap-4 rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
        <div className="text-center">
          <div className="text-2xl font-bold">{summary.agreed}</div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Agreed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{summary.disagreed}</div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Disagreed</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">
            {summary.user_a_disagreement_wins}–{summary.user_b_disagreement_wins}
          </div>
          <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {aAhead ? `${user_a.display_name} leads disagreements` : bAhead ? `${user_b.display_name} leads disagreements` : 'Disagreements tied'}
          </div>
        </div>
      </div>

      {games.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No graded games in scope"
            body="Comparison opens once games are final and graded."
          />
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="py-2 pr-4 text-left font-semibold">Game</th>
                <th className="py-2 pr-4 text-left font-semibold">{user_a.display_name}</th>
                <th className="py-2 pr-4 text-left font-semibold">{user_b.display_name}</th>
                <th className="py-2 text-left font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr
                  key={g.game_id}
                  className="border-b"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: g.agreed ? undefined : 'var(--surface-highlight)',
                  }}
                >
                  <td className="py-2 pr-4">
                    {g.away_team} @ {g.home_team}
                    <span className="ml-2" style={{ color: 'var(--text-muted)' }}>
                      {g.away_score}–{g.home_score}
                    </span>
                    {g.week_id && data.week_id === null && (
                      <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                        Wk {g.week_number}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {g.user_a_pick ?? '—'}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>{gradeBadge(g.user_a_grade)}</span>
                  </td>
                  <td className="py-2 pr-4">
                    {g.user_b_pick ?? '—'}{' '}
                    <span style={{ color: 'var(--text-muted)' }}>{gradeBadge(g.user_b_grade)}</span>
                  </td>
                  <td className="py-2">
                    {g.agreed ? (
                      <span style={{ color: 'var(--text-muted)' }}>Agreed</span>
                    ) : g.user_a_grade === 'win' ? (
                      <span>{user_a.display_name} +1</span>
                    ) : g.user_b_grade === 'win' ? (
                      <span>{user_b.display_name} +1</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>Split</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [state, setState] = useState<CompareState>({ kind: 'loading' });

  useEffect(() => {
    (async () => {
      try {
        const [weeks, seasonRes] = await Promise.all([
          getWeeks(),
          getSeasonStandings('2026').catch(() => getSeasonStandings('current').catch(() => null)),
        ]);
        // Fall back: use the latest season from the weeks list.
        let seasonYear = 2026;
        let participants: SeasonStanding[] = [];
        if (seasonRes) {
          seasonYear = seasonRes.season;
          participants = seasonRes.standings;
        } else if (weeks.length > 0) {
          seasonYear = weeks[0].season;
          const s = await getSeasonStandings(String(seasonYear));
          participants = s.standings;
        }
        const gradedWeeks = weeks.filter((w) => w.status === 'final' || w.status === 'locked');
        const defaultWeek = [...gradedWeeks].sort((a, b) => b.week_number - a.week_number)[0];
        setState({
          kind: 'ready',
          participants,
          weeks,
          seasonYear,
          userA: participants[0]?.user_id ?? '',
          userB: participants[1]?.user_id ?? '',
          scope: defaultWeek ? { kind: 'week', weekId: defaultWeek.id } : { kind: 'season', season: seasonYear },
          data: null,
          dataState: 'idle',
          dataError: null,
        });
      } catch (e) {
        setState({
          kind: 'error',
          message: e instanceof ApiError ? e.message : 'Could not load comparison data.',
        });
      }
    })();
  }, []);

  const fetchData = async (
    userA: string,
    userB: string,
    scope: Scope,
  ) => {
    setState((s) => (s.kind === 'ready' ? { ...s, dataState: 'loading', dataError: null } : s));
    try {
      const data = await getHeadToHead(
        userA,
        userB,
        scope.kind === 'week' ? { week_id: scope.weekId } : { season: scope.season },
      );
      setState((s) => (s.kind === 'ready' ? { ...s, data, dataState: 'idle' } : s));
    } catch (e) {
      setState((s) =>
        s.kind === 'ready'
          ? {
              ...s,
              dataState: 'error',
              dataError: e instanceof ApiError ? e.message : 'Could not load comparison.',
            }
          : s,
      );
    }
  };

  // Auto-fetch when both participants are chosen.
  useEffect(() => {
    if (state.kind === 'ready' && state.userA && state.userB && state.userA !== state.userB) {
      fetchData(state.userA, state.userB, state.scope);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind === 'ready' ? state.userA : null, state.kind === 'ready' ? state.userB : null, state.kind === 'ready' ? JSON.stringify(state.scope) : null]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Compare</h1>
        <p className="mt-4" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-3xl font-extrabold tracking-tight">Compare</h1>
        <div className="mt-8">
          <EmptyState title="Could not load comparison" body={state.message} />
        </div>
      </div>
    );
  }

  const { participants, weeks, seasonYear } = state;
  const gradedWeeks = weeks.filter((w) => w.status === 'final' || w.status === 'locked');

  const setUserA = (id: string) => setState((s) => (s.kind === 'ready' ? { ...s, userA: id } : s));
  const setUserB = (id: string) => setState((s) => (s.kind === 'ready' ? { ...s, userB: id } : s));
  const setScope = (scope: Scope) => setState((s) => (s.kind === 'ready' ? { ...s, scope } : s));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Compare</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Pick any two participants and see agreed picks, disagreed picks, and
        who won more of the games on which they differed.
      </p>

      <div className="mt-6 flex flex-wrap gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--text-muted)' }}>Participant A</span>
          <select
            value={state.userA}
            onChange={(e) => setUserA(e.target.value)}
            className="rounded border px-3 py-2"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {participants.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--text-muted)' }}>Participant B</span>
          <select
            value={state.userB}
            onChange={(e) => setUserB(e.target.value)}
            className="rounded border px-3 py-2"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            {participants.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.display_name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span style={{ color: 'var(--text-muted)' }}>Scope</span>
          <select
            value={state.scope.kind === 'week' ? state.scope.weekId : 'season'}
            onChange={(e) => {
              const v = e.target.value;
              setScope(v === 'season' ? { kind: 'season', season: seasonYear } : { kind: 'week', weekId: v });
            }}
            className="rounded border px-3 py-2"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          >
            <option value="season">Full season</option>
            {gradedWeeks.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.userA === state.userB ? (
        <div className="mt-6">
          <EmptyState
            title="Pick two different participants"
            body="Choose two different people to compare their ledgers."
          />
        </div>
      ) : state.dataState === 'loading' ? (
        <p className="mt-6" style={{ color: 'var(--text-muted)' }}>Loading comparison…</p>
      ) : state.dataState === 'error' ? (
        <div className="mt-6">
          <EmptyState title="Could not load comparison" body={state.dataError ?? ''} />
        </div>
      ) : state.data ? (
        <CompareTable data={state.data} />
      ) : null}
    </div>
  );
}
