import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Rankings' };

const CATEGORIES = [
  {
    name: 'Teams',
    blurb: 'The all-32 composite, exactly as the reports pipeline publishes it.',
  },
  {
    name: 'Quarterbacks',
    blurb: 'All-32 quarterback rankings with metric basis and write-ups.',
  },
  {
    name: 'Offense',
    blurb: 'All-32 offensive unit rankings.',
  },
  {
    name: 'Defense',
    blurb: 'All-32 defensive unit rankings.',
  },
  {
    name: 'Special Teams',
    blurb: 'All-32 special-teams rankings.',
  },
];

/**
 * Rankings hub shell (Phase 1). The hub never computes its own variant —
 * it presents the canonical report editions (Phase 6). Until then, each
 * category is an honest empty state.
 */
export default function RankingsPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Rankings</h1>
      <p className="mt-2 max-w-3xl" style={{ color: 'var(--text-muted)' }}>
        The five in-house all-32 report editions, presented exactly as
        published under the method defined in our-power-rankings-methodology.md.
        The Wednesday outlet roundup appears as a separate, attributed view.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {CATEGORIES.map((cat) => (
          <section key={cat.name} aria-labelledby={`rank-${cat.name}`} className="card">
            <h2 id={`rank-${cat.name}`} className="text-xl font-bold">
              {cat.name}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
              {cat.blurb}
            </p>
            <div className="mt-4">
              <EmptyState
                title="No edition published yet"
                body="The current weekly edition will appear here with position, movement, metric basis, and write-ups."
              />
            </div>
          </section>
        ))}
        <section aria-labelledby="rank-outlet" className="card">
          <h2 id="rank-outlet" className="text-xl font-bold">
            Outlet roundup
          </h2>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            The Wednesday full-32 roundup of outside rankings — attributed, and
            never an input to in-house rankings.
          </p>
          <div className="mt-4">
            <EmptyState
              title="No roundup published yet"
              body="The first Wednesday outlet roundup will be listed here."
            />
          </div>
        </section>
      </div>
    </div>
  );
}
