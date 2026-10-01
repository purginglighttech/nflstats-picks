// db/ingest/nflverse.mjs
// nflverse fallback provider (per the standing data policy: ESPN primary,
// nflverse fallback; Phase 0 GO verdict).
//
// Verified role in Phase 2: team-level special-teams aggregates that ESPN
// does not supply per team (PoC gap #2):
//   - punt_returns / punt_return_yards  -> punt_return_avg
//   - kickoff_returns / kickoff_return_yards -> kick_return_avg
//   - fg_made / fg_att / fg_pct         -> field_goal_pct
//
// Known non-goal: net punt average is in NEITHER source's weekly files
// (checked 2026-10-01); it stays a documented gap until derived from
// play-by-play data (Phase 6 concern).
//
// Asset (verified live): https://github.com/nflverse/nflverse-data/releases/download/stats_team/stats_team_week_{season}.csv
// Only node built-ins.

const RELEASE_BASE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SOURCE = 'nflverse-data GitHub release (no auth)';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** nflverse team codes -> canonical abbreviations (2026 season). */
export const TEAM_CODE_MAP = { LA: 'LAR' };

function canonicalTeam(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  return TEAM_CODE_MAP[c] || c;
}

/** Minimal CSV parse (the file is simple: no quoted commas in practice). */
function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch the weekly team-stats file for a season and return rows for one week
 * as { team_abbr, metric_key, metric_value, display_value } records in the
 * same shape the store layer expects (provider='nflverse').
 */
export async function fetchTeamWeek(season, week) {
  const endpoint = `${RELEASE_BASE}/stats_team/stats_team_week_${season}.csv`;
  const res = await fetch(endpoint, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`nflverse fetch failed: HTTP ${res.status} for ${endpoint}`);
  }
  const rows = parseCsv(await res.text());
  const out = [];
  for (const r of rows) {
    if (Number(r.week) !== Number(week) || Number(r.season) !== Number(season)) continue;
    const teamAbbr = canonicalTeam(r.team);
    const push = (metricKey, metricValue, displayValue, unit) => {
      out.push({ team_abbr: teamAbbr, metric_key: metricKey, metric_value: metricValue, display_value: displayValue ?? null, unit: unit ?? null });
    };
    const pr = num(r.punt_returns);
    const pry = num(r.punt_return_yards);
    if (pr !== null && pr > 0 && pry !== null) {
      push('punt_return_avg', pry / pr, `${pry} yds / ${pr} ret`, 'yards');
    }
    const kr = num(r.kickoff_returns);
    const kry = num(r.kickoff_return_yards);
    if (kr !== null && kr > 0 && kry !== null) {
      push('kick_return_avg', kry / kr, `${kry} yds / ${kr} ret`, 'yards');
    }
    const fgm = num(r.fg_made);
    const fga = num(r.fg_att);
    const fgp = num(r.fg_pct);
    if (fgm !== null && fga !== null && fga > 0) {
      push('field_goal_pct', fgp !== null ? fgp * 100 : (fgm / fga) * 100, `${fgm}/${fga}`, 'percent');
    }
    // Raw counts too — cheap and useful for the Phase 6 team pages.
    if (fgm !== null) push('field_goals_made', fgm, String(fgm), null);
    if (fga !== null) push('field_goal_attempts', fga, String(fga), null);
  }
  return {
    provenance: {
      endpoint,
      fetched_at: new Date().toISOString(),
      source: SOURCE,
    },
    rows: out,
  };
}

export const NFLVERSE_SOURCE = SOURCE;
