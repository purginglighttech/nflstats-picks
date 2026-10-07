'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getGameBoxScore } from '@/lib/api';
import type {
  GameBoxScore,
  GameLeader,
  PlayerGameStat,
  TeamGameStat,
} from '@/lib/types';
import { getTeamTheme } from '@/lib/theme/teams';

type GameState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'ready'; boxScore: GameBoxScore };

function teamName(teamId: string | null): string {
  if (!teamId) return 'Unknown team';
  return getTeamTheme(teamId)?.name ?? teamId.toUpperCase();
}

function teamAbbr(teamId: string | null): string {
  if (!teamId) return '—';
  return getTeamTheme(teamId)?.abbr ?? teamId.toUpperCase();
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "passing_completions" -> "Passing Completions". */
function prettifyKey(key: string): string {
  return key
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * Compound team stats arrive as two rows ("3rd Down Efficiency (first of
 * 5-16)" / "(second of 5-16)") sharing one verbatim display_value. The
 * label suffix is provider bookkeeping; the display value is the truth.
 */
function baseLabel(label: string | null): string {
  if (!label) return '—';
  return label.replace(/\s*\((first|second) of .*\)$/, '');
}

function statValue(stat: TeamGameStat | PlayerGameStat): string {
  if (stat.display_value !== null && stat.display_value !== '') {
    return stat.display_value;
  }
  if (stat.metric_value !== null) return String(stat.metric_value);
  return '—';
}

/* ------------------------------------------------------------------ */
/* Scoring by quarter                                                  */
/* ------------------------------------------------------------------ */

function Linescore({ boxScore }: { boxScore: GameBoxScore }) {
  const { game, periods } = boxScore;
  if (periods.length === 0) return null;
  const maxPeriod = Math.max(...periods.map((p) => p.period_number));
  const byTeam = new Map<string, Map<number, number>>();
  for (const p of periods) {
    if (!byTeam.has(p.team_id)) byTeam.set(p.team_id, new Map());
    byTeam.get(p.team_id)!.set(p.period_number, p.points);
  }
  const order = [game.away_team_id, game.home_team_id].filter((t) =>
    byTeam.has(t),
  );
  for (const [team] of byTeam) {
    if (!order.includes(team)) order.push(team);
  }
  const headers: string[] = [];
  for (let n = 1; n <= maxPeriod; n++) {
    headers.push(n <= 4 ? String(n) : n === 5 ? 'OT' : `OT${n - 4}`);
  }
  return (
    <section aria-label="Scoring by quarter" className="mt-8">
      <h2 className="field-label">Scoring by quarter</h2>
      <div className="card mt-2 max-w-2xl overflow-x-auto p-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="pr-3 font-semibold">Team</th>
              {headers.map((h) => (
                <th key={h} scope="col" className="px-2 text-center font-semibold">
                  {h}
                </th>
              ))}
              <th scope="col" className="pl-2 text-center font-semibold">T</th>
            </tr>
          </thead>
          <tbody>
            {order.map((team) => {
              const per = byTeam.get(team)!;
              const total = [...per.values()].reduce((a, b) => a + b, 0);
              return (
                <tr key={team} className="border-t">
                  <td className="py-1 pr-3 font-semibold">{teamAbbr(team)}</td>
                  {headers.map((_, i) => (
                    <td key={i} className="px-2 py-1 text-center">
                      {per.get(i + 1) ?? '–'}
                    </td>
                  ))}
                  <td className="py-1 pl-2 text-center font-bold">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Team stats comparison                                               */
/* ------------------------------------------------------------------ */

function TeamStats({ boxScore }: { boxScore: GameBoxScore }) {
  const { game, team_stats } = boxScore;
  if (team_stats.length === 0) return null;
  const byPosition = new Map<
    number,
    { away?: TeamGameStat; home?: TeamGameStat }
  >();
  for (const s of team_stats) {
    if (!byPosition.has(s.position)) byPosition.set(s.position, {});
    const slot = byPosition.get(s.position)!;
    if (s.team_id === game.away_team_id) slot.away = slot.away ?? s;
    else if (s.team_id === game.home_team_id) slot.home = slot.home ?? s;
  }
  const positions = [...byPosition.keys()].sort((a, b) => a - b);
  return (
    <section aria-label="Team stats" className="mt-8">
      <h2 className="field-label">Team stats</h2>
      <div className="card mt-2 max-w-3xl overflow-x-auto p-4">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="pr-3 font-semibold">
                {teamAbbr(game.away_team_id)}
              </th>
              <th scope="col" className="px-3 text-center font-semibold" />
              <th scope="col" className="pl-3 text-right font-semibold">
                {teamAbbr(game.home_team_id)}
              </th>
            </tr>
          </thead>
          <tbody>
            {positions.map((pos) => {
              const { away, home } = byPosition.get(pos)!;
              const label = baseLabel(
                away?.display_label ?? home?.display_label ?? null,
              );
              return (
                <tr key={pos} className="border-t">
                  <td className="py-1 pr-3">{away ? statValue(away) : '–'}</td>
                  <td className="px-3 py-1 text-center" style={{ color: 'var(--text-muted)' }}>
                    {label}
                  </td>
                  <td className="py-1 pl-3 text-right">
                    {home ? statValue(home) : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Game leaders                                                        */
/* ------------------------------------------------------------------ */

function Leaders({ boxScore }: { boxScore: GameBoxScore }) {
  const { game, leaders } = boxScore;
  if (leaders.length === 0) return null;
  const groups = new Map<string, GameLeader[]>();
  for (const l of leaders) {
    const key = `${l.team_id}::${l.category_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(l);
  }
  const order = [game.away_team_id, game.home_team_id];
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    const [ta] = a.split('::');
    const [tb] = b.split('::');
    return order.indexOf(ta) - order.indexOf(tb);
  });
  return (
    <section aria-label="Game leaders" className="mt-8">
      <h2 className="field-label">Game leaders</h2>
      <div className="mt-2 grid max-w-3xl gap-3 sm:grid-cols-2">
        {sorted.map(([key, group]) => {
          const [team] = key.split('::');
          const first = group[0];
          return (
            <div key={key} className="card p-4">
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {teamAbbr(team)} ·{' '}
                {first.category_label ?? prettifyKey(first.category_key)}
              </p>
              <ul className="mt-1">
                {group.map((l, i) => (
                  <li key={i} className="mt-1 text-sm">
                    <span className="font-semibold">
                      {l.player_name ?? 'Unknown player'}
                    </span>{' '}
                    — {l.display_value ?? (l.metric_value ?? '–')}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Player stats                                                        */
/* ------------------------------------------------------------------ */

interface PlayerLine {
  name: string;
  /** Merged "label: value" chips; compound pairs share one verbatim value. */
  chips: string[];
}

function playerLines(stats: PlayerGameStat[]): PlayerLine[] {
  const byPlayer = new Map<string, PlayerGameStat[]>();
  for (const s of stats) {
    const key = s.player_name ?? s.metric_key;
    if (!byPlayer.has(key)) byPlayer.set(key, []);
    byPlayer.get(key)!.push(s);
  }
  return [...byPlayer.entries()].map(([name, rows]) => {
    // Merge compound splits: rows sharing the verbatim display value are one chip.
    const byValue = new Map<string, string[]>();
    const order: string[] = [];
    for (const r of rows) {
      const value = statValue(r);
      if (!byValue.has(value)) {
        byValue.set(value, []);
        order.push(value);
      }
      byValue.get(value)!.push(prettifyKey(r.display_label ?? r.metric_key));
    }
    return {
      name,
      chips: order.map(
        (value) => `${[...new Set(byValue.get(value)!)].join(' / ')} ${value}`,
      ),
    };
  });
}

function PlayerStats({ boxScore }: { boxScore: GameBoxScore }) {
  const { game, player_stats } = boxScore;
  if (player_stats.length === 0) return null;
  const groups = new Map<string, PlayerGameStat[]>();
  for (const s of player_stats) {
    const key = `${s.team_id ?? ''}::${s.category_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  const order = [game.away_team_id, game.home_team_id];
  const sorted = [...groups.entries()].sort(([a], [b]) => {
    const [ta, ca] = a.split('::');
    const [tb, cb] = b.split('::');
    const d = order.indexOf(ta) - order.indexOf(tb);
    return d !== 0 ? d : ca.localeCompare(cb);
  });
  return (
    <section aria-label="Player stats" className="mt-8">
      <h2 className="field-label">Player stats</h2>
      <p className="field-hint mt-1 max-w-3xl">
        Complete available normalized game-stat breakdowns. Team attribution
        for games ingested before the attribution column landed comes from the
        recorded game leaders; unattributed players are grouped without a team.
      </p>
      <div className="mt-2 flex max-w-4xl flex-col gap-6">
        {sorted.map(([key, stats]) => {
          const [team, category] = key.split('::');
          return (
            <div key={key}>
              <h3 className="font-bold">
                {team ? `${teamAbbr(team)} — ` : ''}
                {prettifyKey(category)}
              </h3>
              <ul className="mt-1 flex flex-col gap-1">
                {playerLines(stats).map((line) => (
                  <li key={line.name} className="text-sm">
                    <span className="font-semibold">{line.name}</span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {' '}
                      · {line.chips.join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

/**
 * The canonical game page (Phase 2): one URL serves all three life phases.
 * Scheduled games show the matchup and an honest preview placeholder (the
 * preview pipeline is a later phase); in-progress games show the live score;
 * final games show the report card with the full box-score drill-down.
 */
export default function GamePage() {
  const params = useParams<{ id: string }>();
  const gameId = params.id;
  const [state, setState] = useState<GameState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const boxScore = await getGameBoxScore(gameId);
        if (!cancelled) setState({ kind: 'ready', boxScore });
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 404) {
            setState({ kind: 'not-found' });
          } else {
            setState({
              kind: 'error',
              message:
                err instanceof ApiError ? err.message : 'Could not load the game.',
            });
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <p role="status">Loading game…</p>
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
            title={state.kind === 'not-found' ? 'Game not found' : 'Could not load the game'}
            body={
              state.kind === 'not-found'
                ? 'No ingested game matches this address.'
                : state.message
            }
          />
        </div>
      </div>
    );
  }

  const { boxScore } = state;
  const { game } = boxScore;
  const hasScore = game.status !== 'scheduled';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="mb-4">
        <Link href={`/weeks/${game.week_number}`} className="link">
          ← Week {game.week_number}
        </Link>
      </p>

      <header>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {game.season} season · Week {game.week_number}
        </p>
        <h1 className="mt-1 text-3xl font-extrabold tracking-tight">
          {teamName(game.away_team_id)} at {teamName(game.home_team_id)}
        </h1>
        <p className="mt-2 text-lg">
          {hasScore ? (
            <span className="font-bold">
              {teamAbbr(game.away_team_id)} {game.away_score ?? '–'} —{' '}
              {teamAbbr(game.home_team_id)} {game.home_score ?? '–'}
            </span>
          ) : (
            <span style={{ color: 'var(--text-muted)' }}>
              {formatKickoff(game.kickoff_at)}
            </span>
          )}
          <span
            className="ml-3 text-sm"
            style={{ color: 'var(--text-muted)' }}
          >
            {game.status === 'final'
              ? 'Final'
              : game.status === 'in_progress'
                ? 'In progress'
                : `Scheduled · ${formatKickoff(game.kickoff_at)}`}
          </span>
        </p>
      </header>

      {game.status === 'scheduled' ? (
        <div className="mt-8 max-w-md">
          <EmptyState
            title="Preview not yet published"
            body="Probabilities, matchup stats, and the qualitative scorecard arrive with the preview pipeline. This page becomes the full report card once the game is final."
          />
        </div>
      ) : null}

      {game.status === 'in_progress' ? (
        <p className="field-hint mt-8 max-w-2xl">
          Game in progress — the score and box score refresh as the ingest
          pipeline delivers updates.
        </p>
      ) : null}

      {game.status === 'final' ? (
        <>
          <Linescore boxScore={boxScore} />
          <TeamStats boxScore={boxScore} />
          <Leaders boxScore={boxScore} />
          <PlayerStats boxScore={boxScore} />
          {boxScore.periods.length === 0 &&
          boxScore.team_stats.length === 0 &&
          boxScore.player_stats.length === 0 &&
          boxScore.leaders.length === 0 ? (
            <div className="mt-8 max-w-md">
              <EmptyState
                title="Box score not yet ingested"
                body="The final score is in, but the detailed box-score breakdown has not arrived from the ingest pipeline yet."
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
