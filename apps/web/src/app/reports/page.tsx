import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Reports' };

/**
 * Reports archive shell (Phase 1). Filters and editions arrive with the
 * reports pipeline (Phase 6); the controls below are visibly disabled
 * until then so nothing implies content exists.
 */
export default function ReportsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Reports</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every recurring NFL Stats &amp; Analysis output — final-game reports,
        news and personnel briefings, injury sweeps, pregame checks, post-week
        reviews, power rankings, and Wednesday previews — preserved as readable
        web content.
      </p>

      <fieldset className="mt-6" disabled aria-describedby="reports-filters-hint">
        <legend className="kicker">Filter</legend>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="report-type" className="field-label">
              Report type
            </label>
            <select id="report-type" className="select-input">
              <option value="">All types</option>
            </select>
          </div>
          <div>
            <label htmlFor="report-season" className="field-label">
              Season
            </label>
            <select id="report-season" className="select-input">
              <option value="">All seasons</option>
            </select>
          </div>
          <div>
            <label htmlFor="report-week" className="field-label">
              Week
            </label>
            <select id="report-week" className="select-input">
              <option value="">All weeks</option>
            </select>
          </div>
        </div>
      </fieldset>
      <p id="reports-filters-hint" className="field-hint">
        Filters activate when the first report edition publishes.
      </p>

      <div className="mt-8">
        <EmptyState
          title="No reports in the archive yet"
          body="Report editions will be listed here — newest first, filterable by type, season, week, team, and publication date — once the pipeline publishes them."
        />
      </div>
    </div>
  );
}
