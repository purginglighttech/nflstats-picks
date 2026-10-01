import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { TEAM_THEMES } from '@/lib/theme/teams';

/**
 * Public homepage shell (Phase 1). Real content — news feed, report
 * editions, team statistics — arrives with the Phase 6 content pipeline;
 * every module below is an honest placeholder until then.
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
          <EmptyState
            title="No reports published yet"
            body="Power rankings, injury briefings, pregame checks, and post-week reviews will appear here as the reports pipeline comes online."
          />
        </div>
      </section>

      {/* Team quick-look shell */}
      <section aria-labelledby="teams-heading" className="mt-12 max-w-xl">
        <h2 id="teams-heading" className="text-2xl font-bold tracking-tight">
          Team quick look
        </h2>
        <p className="mt-2" style={{ color: 'var(--text-muted)' }}>
          Pick a team to preview its season statistics panel.
        </p>
        <div className="mt-4">
          <label htmlFor="team-select" className="field-label">
            Team
          </label>
          <select id="team-select" className="select-input" disabled aria-describedby="team-select-hint">
            <option value="">Select a team…</option>
            {TEAM_THEMES.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.name}
              </option>
            ))}
          </select>
          <p id="team-select-hint" className="field-hint">
            Team pages arrive in a later phase; the selector is disabled until then.
          </p>
        </div>
      </section>
    </div>
  );
}
