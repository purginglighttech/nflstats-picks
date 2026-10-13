'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmptyState } from '@/components/EmptyState';
import { Markdown } from '@/components/Markdown';
import { ApiError, getReport } from '@/lib/api';
import {
  REPORT_TYPE_LABELS,
  type ReportBlockType,
  type ReportDetailResponse,
} from '@/lib/types';

const BLOCK_LABELS: Record<ReportBlockType, string> = {
  evidence: 'Evidence',
  interpretation: 'Our interpretation',
  summary: 'Summary',
};

const CORROBORATION_LABELS: Record<string, string> = {
  confirmed_multi_source: 'Confirmed by multiple sources',
  single_source_exception: 'Single source',
  not_applicable: 'Not applicable',
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'error' }
  | { kind: 'ready'; data: ReportDetailResponse };

/**
 * Report reader: one published edition. Entries render in order with
 * their block type labeled — evidence and interpretation are never
 * blended unlabeled. Provenance (methodology + dataset revision) and
 * the edition's citations are shown, not hidden.
 */
export default function ReportReaderPage() {
  const params = useParams<{ id: string }>();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getReport(params.id);
        if (!cancelled) setState({ kind: 'ready', data });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: 'not_found' });
        } else {
          setState({ kind: 'error' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (state.kind === 'loading') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <p role="status" style={{ color: 'var(--text-muted)' }}>
          Loading report…
        </p>
      </div>
    );
  }
  if (state.kind === 'not_found') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <EmptyState
          title="Report not found"
          body="This edition doesn't exist or hasn't been published yet."
        />
        <p className="mt-4">
          <Link href="/reports" className="nav-link">
            ← Back to the archive
          </Link>
        </p>
      </div>
    );
  }
  if (state.kind === 'error') {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        <EmptyState
          title="Something went wrong"
          body="Could not load this report. Please try again."
        />
      </div>
    );
  }

  const { report, entries, citations } = state.data;
  const meta: string[] = [];
  if (report.season) meta.push(`Season ${report.season}`);
  if (report.week_label) meta.push(report.week_label);
  else if (report.week_number) meta.push(`Week ${report.week_number}`);
  if (report.reporting_period) meta.push(report.reporting_period);
  meta.push(
    `Published ${new Date(report.updated_at).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })}`
  );
  const provenance: string[] = [];
  if (report.methodology_version)
    provenance.push(`Methodology ${report.methodology_version}`);
  if (report.dataset_revision) provenance.push(`Dataset ${report.dataset_revision}`);
  if (report.revision > 1) provenance.push(`Revision ${report.revision}`);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/reports" className="nav-link text-sm">
        ← All reports
      </Link>

      <p className="kicker mt-6">{REPORT_TYPE_LABELS[report.report_type]}</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{report.title}</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        {meta.join(' · ')}
      </p>
      {provenance.length > 0 && (
        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
          {provenance.join(' · ')}
        </p>
      )}
      {report.summary && (
        <p className="mt-4 text-lg leading-relaxed">{report.summary}</p>
      )}

      <div className="mt-6">
        {entries.map((entry) => (
          <section key={entry.entry_key} className="mt-8">
            <p
              className="kicker"
              style={
                entry.block_type === 'interpretation'
                  ? { color: 'var(--accent, var(--text-muted))' }
                  : undefined
              }
            >
              {BLOCK_LABELS[entry.block_type]}
            </p>
            {entry.heading && (
              <h2 className="mt-1 text-xl font-bold tracking-tight">
                {entry.heading}
              </h2>
            )}
            <Markdown text={entry.body} />
          </section>
        ))}
      </div>

      {citations.length > 0 && (
        <section className="mt-12 border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-lg font-bold">Sources</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {citations.map((c, i) => (
              <li key={i}>
                <a href={c.url} target="_blank" rel="noreferrer">
                  {c.publisher ?? c.url}
                </a>
                {c.claim_key && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    — claim {c.claim_key}
                  </span>
                )}
                {c.corroboration_status && (
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}
                    · {CORROBORATION_LABELS[c.corroboration_status]}
                  </span>
                )}
                {c.limitation_note && (
                  <span className="block" style={{ color: 'var(--text-muted)' }}>
                    {c.limitation_note}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
