'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getTeams } from '@/lib/api';
import type { TeamSummary, TeamsResponse } from '@/lib/types';

const DIVISION_ORDER = ['East', 'North', 'South', 'West'];

function record(t: TeamSummary): string {
  return t.ties > 0 ? `${t.wins}–${t.losses}–${t.ties}` : `${t.wins}–${t.losses}`;
}

function TeamCard({ team }: { team: TeamSummary }) {
  return (
    <Link
      href={`/teams/${team.abbreviation}`}
      className="block rounded-lg border p-4 transition hover:shadow"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
    >
      <div
        className="mb-3 h-1.5 w-10 rounded"
        style={{ backgroundColor: team.accent_light }}
        aria-hidden
      />
      <div className="font-semibold">
        {team.city} {team.name}
      </div>
      <div className="mt-1 flex items-baseline justify-between text-sm" style={{ color: 'var(--text-muted)' }}>
        <span>
          {team.abbreviation} · {team.conference} {team.division}
        </span>
        <span className="font-semibold" style={{ color: 'var(--text)' }}>
          {record(team)}
        </span>
      </div>
      <div className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        PF {team.points_for} · PA {team.points_against}
      </div>
    </Link>
  );
}

export default function TeamsPage() {
  const [data, setData] = useState<TeamsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getTeams()
      .then(setData)
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : 'Could not load teams.'),
      );
  }, []);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Teams</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every club, its record, and its season — schedules, leaders, and how
        the pool has picked them.
      </p>

      {error ? (
        <div className="mt-8">
          <EmptyState title="Could not load teams" body={error} />
        </div>
      ) : !data ? (
        <p className="mt-8" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : (
        (['AFC', 'NFC'] as const).map((conf) => (
          <section key={conf} className="mt-10">
            <h2 className="text-xl font-bold">{conf}</h2>
            {DIVISION_ORDER.map((div) => {
              const teams = data.teams.filter(
                (t) => t.conference === conf && t.division === div,
              );
              if (teams.length === 0) return null;
              return (
                <div key={div} className="mt-4">
                  <h3
                    className="text-sm font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {conf} {div}
                  </h3>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {teams.map((t) => (
                      <TeamCard key={t.abbreviation} team={t} />
                    ))}
                  </div>
                </div>
              );
            })}
          </section>
        ))
      )}
    </div>
  );
}
