import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Standings' };

/**
 * Standings shell (Phase 1, member-only via sibling C middleware).
 * Weekly/season standings arrive with grading (Phase 3+).
 */
export default function StandingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Standings</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Weekly and season standings — rank, record, accuracy, movement, and
        games behind.
      </p>
      <div className="mt-8">
        <EmptyState
          title="Standings arrive with the first graded week"
          body="Once games are played and graded, this page shows the weekly and season leaderboards. This feature is coming in a later phase."
        />
      </div>
    </div>
  );
}
