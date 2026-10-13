import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { TeamQuickLook } from '@/components/TeamQuickLook';
import { LatestReports } from '@/components/LatestReports';

/**
 * Public homepage. The team picker and Latest Reports modules are live;
 * the Games of the Week teaser stays an honest placeholder until the
 * first features edition publishes.
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Hero */}
      <section aria-labelledby="hero-heading" className="max-w-3xl">
        <p className="kicker">Purging Light Technology</p>
        <h1
          id="hero-heading"
          className="mt-2 text-4xl font-extrabold tracking-tight sm:text-5xl"
        >
          NFL Pick&apos;em, built on evidence
        </h1>
        <p className="mt-4 text-lg leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Follow league news, explore team statistics, read the full NFL Stats
          &amp; Analysis report library — then pick every game&apos;s winner in
          one shared weekly competition.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href="/picks" className="btn btn-primary">
            Make Picks
          </Link>
          <Link href="/weeks" className="btn btn-secondary">
            Browse weekly games
          </Link>
        </div>
      </section>

      {/* Games of the Week teaser / season preview placeholder */}
      <section aria-labelledby="gotw-heading" className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="gotw-heading" className="text-2xl font-bold tracking-tight">
            Games of the Week
          </h2>
          <Link href="/features" className="nav-link text-sm">
            All editions
          </Link>
        </div>
        <div className="mt-4">
          <EmptyState
            title="Season preview coming soon"
            body="The Wednesday full-slate Games of the Week analysis will be featured here once the first edition publishes. No edition exists yet."
          />
        </div>
      </section>

      {/* Latest Reports module shell */}
      <section aria-labelledby="reports-heading" className="mt-12">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="reports-heading" className="text-2xl font-bold tracking-tight">
            Latest Reports
          </h2>
          <Link href="/reports" className="nav-link text-sm">
            Report archive
          </Link>
        </div>
        <div className="mt-4">
          <LatestReports />
        </div>
      </section>

      {/* Team quick-look: picker navigates to the team's page */}
      <section aria-labelledby="teams-heading" className="mt-12 max-w-xl">
        <h2 id="teams-heading" className="text-2xl font-bold tracking-tight">
          Team quick look
        </h2>
        <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
          Pick a team to open its page.
        </p>
        <TeamQuickLook />
      </section>
    </div>
  );
}
