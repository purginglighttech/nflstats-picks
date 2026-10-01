import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Games of the Week' };

/**
 * Games of the Week shell (Phase 1). Editions publish Wednesdays via the
 * reports pipeline (Phase 6); until then, an honest empty state.
 */
export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Games of the Week</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Every Wednesday: the full slate analyzed — probabilities, statistics,
        the qualitative scorecard, and how we got here, with uncertainty stated
        up front.
      </p>
      <div className="mt-8">
        <EmptyState
          title="No edition published yet"
          body="The first Wednesday edition will appear here once the reports pipeline publishes it. Each game links to its canonical page with the pre-Wednesday, preview, and post-final phases."
        />
      </div>
    </div>
  );
}
