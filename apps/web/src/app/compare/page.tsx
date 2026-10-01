import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Compare' };

/**
 * Compare shell (Phase 1, member-only via sibling C middleware).
 * Head-to-head comparison arrives with grading (Phase 3+).
 */
export default function ComparePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Compare</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Pick any two participants and see agreed picks, disagreed picks, and
        who won more of the games on which they differed.
      </p>
      <div className="mt-8">
        <EmptyState
          title="Comparison opens with the first graded week"
          body="Once picks are graded, choose two participants and a week-or-season filter to compare ledgers side by side. This feature is coming in a later phase."
        />
      </div>
    </div>
  );
}
