'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { getReports } from '@/lib/api';
import {
  REPORT_TYPE_LABELS,
  type ReportListItem,
  type ReportType,
} from '@/lib/types';

const CONTENT_CLASS_LABELS: Record<ReportListItem['content_class'], string> = {
  factual: 'Factual',
  prediction: 'Prediction',
  opinion: 'Opinion',
  mixed: 'Mixed',
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; reports: ReportListItem[] };

const NO_REPORTS: ReportListItem[] = [];

function metaLine(r: ReportListItem): string {
  const parts: string[] = [];
  if (r.season) parts.push(`Season ${r.season}`);
  if (r.week_label) parts.push(r.week_label);
  else if (r.week_number) parts.push(`Week ${r.week_number}`);
  if (r.reporting_period) parts.push(r.reporting_period);
  parts.push(new Date(r.updated_at).toLocaleDateString());
  return parts.join(' · ');
}

/**
 * Reports archive: every published edition, newest first, filterable by
 * type, season, and week. Filter options derive from the editions
 * themselves, so a filter never offers a combination with nothing in it.
 */
export default function ReportsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [typeFilter, setTypeFilter] = useState('');
  const [seasonFilter, setSeasonFilter] = useState('');
  const [weekFilter, setWeekFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await getReports();
        if (!cancelled) setState({ kind: 'ready', reports: res.reports });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const reports = useMemo(
    () => (state.kind === 'ready' ? state.reports : NO_REPORTS),
    [state]
  );

  const typeOptions = useMemo(
    () =>
      [...new Set(reports.map((r) => r.report_type))].sort((a, b) =>
        REPORT_TYPE_LABELS[a].localeCompare(REPORT_TYPE_LABELS[b])
      ),
    [reports]
  );
  const seasonOptions = useMemo(
    () =>
      [...new Set(reports.map((r) => r.season).filter((s) => s !== null))].sort(
        (a, b) => (b ?? 0) - (a ?? 0)
      ),
    [reports]
  );
  const weekOptions = useMemo(
    () =>
      [...new Set(reports.map((r) => r.week_number).filter((w) => w !== null))].sort(
        (a, b) => (a ?? 0) - (b ?? 0)
      ),
    [reports]
  );

  const filtered = reports.filter((r) => {
    if (typeFilter && r.report_type !== typeFilter) return false;
    if (seasonFilter && r.season !== Number(seasonFilter)) return false;
    if (weekFilter && r.week_number !== Number(weekFilter)) return false;
    return true;
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Reports</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every recurring NFL Stats &amp; Analysis output — final-game reports,
        news and personnel briefings, injury sweeps, pregame checks, post-week
        reviews, power rankings, and Wednesday previews — preserved as readable
        web content.
      </p>

      {state.kind === 'ready' && reports.length > 0 && (
        <fieldset className="mt-6">
          <legend className="kicker">Filter</legend>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="report-type" className="field-label">
                Report type
              </label>
              <select
                id="report-type"
                className="select-input"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>
                    {REPORT_TYPE_LABELS[t as ReportType]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="report-season" className="field-label">
                Season
              </label>
              <select
                id="report-season"
                className="select-input"
                value={seasonFilter}
                onChange={(e) => setSeasonFilter(e.target.value)}
              >
                <option value="">All seasons</option>
                {seasonOptions.map((s) => (
                  <option key={s} value={s ?? ''}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="report-week" className="field-label">
                Week
              </label>
              <select
                id="report-week"
                className="select-input"
                value={weekFilter}
                onChange={(e) => setWeekFilter(e.target.value)}
              >
                <option value="">All weeks</option>
                {weekOptions.map((w) => (
                  <option key={w} value={w ?? ''}>
                    Week {w}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>
      )}

      <div className="mt-8">
        {state.kind === 'loading' ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Loading reports…
          </p>
        ) : state.kind === 'error' ? (
          <EmptyState
            title="Something went wrong"
            body="Could not load reports. Please try again."
          />
        ) : reports.length === 0 ? (
          <EmptyState
            title="No reports in the archive yet"
            body="Report editions will be listed here — newest first, filterable by type, season, week, team, and publication date — once the pipeline publishes them."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No reports match those filters"
            body="Try a different type, season, or week."
          />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filtered.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/reports/${r.id}`}
                  className="block rounded-xl border p-5 transition hover:opacity-90"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--text)',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="kicker">
                      {REPORT_TYPE_LABELS[r.report_type]}
                    </span>
                    <span
                      className="rounded-full border px-2 py-0.5 text-xs font-semibold"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {CONTENT_CLASS_LABELS[r.content_class]}
                    </span>
                  </div>
                  <h2 className="mt-2 text-lg font-bold leading-snug">{r.title}</h2>
                  <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                    {metaLine(r)}
                  </p>
                  {r.summary && (
                    <p className="mt-2 text-sm leading-relaxed">{r.summary}</p>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
