'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { getReports } from '@/lib/api';
import { REPORT_TYPE_LABELS, type ReportListItem } from '@/lib/types';

/**
 * Home "Latest Reports" module: the three most recent published
 * editions. Falls back to the placeholder copy until the first edition
 * publishes, and stays silent (placeholder) if the fetch fails — the
 * home page never breaks over a reports outage.
 */
export function LatestReports() {
  const [reports, setReports] = useState<ReportListItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getReports();
        if (!cancelled) setReports(res.reports.slice(0, 3));
      } catch {
        if (!cancelled) setReports([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (reports === null || reports.length === 0) {
    return (
      <EmptyState
        title="No reports published yet"
        body="Power rankings, injury briefings, pregame checks, and post-week reviews will appear here as the reports pipeline comes online."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {reports.map((r) => (
        <li key={r.id}>
          <Link
            href={`/reports/${r.id}`}
            className="block h-full rounded-xl border p-5 transition hover:opacity-90"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--text)',
            }}
          >
            <span className="kicker">{REPORT_TYPE_LABELS[r.report_type]}</span>
            <h3 className="mt-2 font-bold leading-snug">{r.title}</h3>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {[r.week_label, new Date(r.updated_at).toLocaleDateString()]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {r.summary && (
              <p className="mt-2 line-clamp-3 text-sm leading-relaxed">{r.summary}</p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
