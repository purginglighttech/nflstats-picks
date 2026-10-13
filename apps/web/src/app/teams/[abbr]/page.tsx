'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getTeam } from '@/lib/api';
import type { TeamDetailResponse, TeamLeader } from '@/lib/types';

function recordLine(r: { wins: number; losses: number; ties: number }): string {
  return r.ties > 0 ? `${r.wins}–${r.losses}–${r.ties}` : `${r.wins}–${r.losses}`;
}

function LeaderCard({
  title,
  leader,
  extraLabel,
}: {
  title: string;
  leader: TeamLeader | null;
  extraLabel?: string;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div
        className="text-xs font-semibold uppercase tracking-wide"
        style={{ color: 'var(--text-muted)' }}
      >
        {title}
      </div>
      {leader ? (
        <>
          <div className="mt-2 font-semibold">{leader.player_name}</div>
          <div className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            {Math.round(leader.yards).toLocaleString()} yds · {Math.round(leader.touchdowns)} TD
            {extraLabel && leader.receptions !== null
              ? ` · ${Math.round(leader.receptions)} ${extraLabel}`
              : ''}
          </div>
        </>
      ) : (
        <div className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          No stats yet
        </div>
      )}
    </div>
  );
}

export default function TeamPage() {
  const params = useParams<{ abbr: string }>();
  const abbr = (params.abbr ?? '').toUpperCase();
  const [data, setData] = useState<TeamDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abbr) return;
    getTeam(abbr)
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Could not load this team.'),
      );
  }, [abbr]);

  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mt-8">
          <EmptyState title="Could not load this team" body={error} />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <p style={{ color: 'var(--text-muted)' }}>Loading…</p>
      </div>
    );
  }

  const { team, schedule, leaders, pool } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/teams" className="text-sm" style={{ color: 'var(--text-muted)' }}>
        ← All teams
      </Link>

      <div
        className="mt-4 h-2 w-16 rounded"
        style={{ backgroundColor: team.accent_light }}
        aria-hidden
      />
      <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
        {team.city} {team.name}
      </h1>
      <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
        {team.abbreviation} · {team.conference} {team.division} ·{' '}
        <span className="font-semibold" style={{ color: 'var(--text)' }}>
          {recordLine(team)}
        </span>{' '}
        · PF {team.points_for} · PA {team.points_against}
      </p>

      <h2 className="mt-10 text-xl font-bold">Season leaders</h2>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LeaderCard title="Passing" leader={leaders.passing} />
        <LeaderCard title="Rushing" leader={leaders.rushing} />
        <LeaderCard title="Receiving" leader={leaders.receiving} extraLabel="rec" />
      </div>

      <h2 className="mt-10 text-xl font-bold">Schedule</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
              <th className="py-2 pr-4 text-left font-semibold">Week</th>
              <th className="py-2 pr-4 text-left font-semibold">Matchup</th>
              <th className="py-2 text-left font-semibold">Result</th>
            </tr>
          </thead>
          <tbody>
            {schedule.map((g) => (
              <tr key={g.game_id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                <td className="py-2 pr-4" style={{ color: 'var(--text-muted)' }}>
                  {g.week_label}
                </td>
                <td className="py-2 pr-4">
                  <Link href={`/games/${g.game_id}`} className="hover:underline">
                    {g.is_home ? 'vs' : 'at'} {g.opponent}
                  </Link>
                </td>
                <td className="py-2">
                  {g.result ? (
                    <span>
                      <span className="font-semibold">{g.result}</span>{' '}
                      <span style={{ color: 'var(--text-muted)' }}>
                        {g.team_score}–{g.opponent_score}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>
                      {new Date(g.scheduled_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-xl font-bold">How the pool picks them</h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Graded picks on {team.name} games this season. Records are each
        pick&apos;s own result.
      </p>
      {pool.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="No graded picks yet"
            body="This section fills in once the team's games are final and graded."
          />
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="py-2 pr-4 text-left font-semibold">Participant</th>
                <th className="py-2 pr-4 text-left font-semibold">Picked them</th>
                <th className="py-2 text-left font-semibold">Picked against</th>
              </tr>
            </thead>
            <tbody>
              {pool.map((p) => (
                <tr key={p.user_id} className="border-b" style={{ borderColor: 'var(--border)' }}>
                  <td className="py-2 pr-4 font-medium">{p.display_name}</td>
                  <td className="py-2 pr-4">
                    {p.picked_for.picks > 0
                      ? `${p.picked_for.picks} picks · ${recordLine(p.picked_for)}`
                      : '—'}
                  </td>
                  <td className="py-2">
                    {p.picked_against.picks > 0
                      ? `${p.picked_against.picks} picks · ${recordLine(p.picked_against)}`
                      : '—'}
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
