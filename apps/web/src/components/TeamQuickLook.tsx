'use client';

import { useRouter } from 'next/navigation';
import { TEAM_THEMES } from '@/lib/theme/teams';

/**
 * Home page team picker: selecting a club navigates to its team page
 * (/teams/[abbr] — schedule, leaders, season stats, pool pick record).
 * Client component because the home page itself is server-rendered.
 */
export function TeamQuickLook() {
  const router = useRouter();
  return (
    <div className="mt-4">
      <label htmlFor="team-select" className="field-label">
        Team
      </label>
      <select
        id="team-select"
        className="select-input"
        defaultValue=""
        aria-describedby="team-select-hint"
        onChange={(e) => {
          if (e.target.value) router.push(`/teams/${e.target.value}`);
        }}
      >
        <option value="">Select a team…</option>
        {TEAM_THEMES.map((t) => (
          <option key={t.teamId} value={t.teamId}>
            {t.name}
          </option>
        ))}
      </select>
      <p id="team-select-hint" className="field-hint">
        Opens the team&apos;s page: schedule, leaders, season stats, and how
        the pool has picked them.
      </p>
    </div>
  );
}
