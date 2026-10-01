import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Weekly Games' };

/**
 * Weekly Games shell (Phase 1). The week selector and game slates arrive
 * with Phase 2 ingestion; until then the page is an honest empty state.
 */
export default function WeeksPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Weekly Games</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every season week gets a stable page with the full slate, scores, and
        box-score drill-downs.
      </p>

      <div className="mt-6 max-w-md">
        <label htmlFor="week-select" className="field-label">
          Season week
        </label>
        <select id="week-select" className="select-input" disabled aria-describedby="week-select-hint">
          <option value="">No weeks available yet</option>
        </select>
        <p id="week-select-hint" className="field-hint">
          The schedule arrives with game-data ingestion in a later phase.
        </p>
      </div>

      <div className="mt-8">
        <EmptyState
          title="No weeks scheduled yet"
          body="Once game data is ingested, this page lists the active week's complete slate. Past weeks remain available at their permanent addresses."
        />
      </div>
    </div>
  );
}
