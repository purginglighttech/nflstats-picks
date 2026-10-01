// db/ingest/espn.mjs
// ESPN public NFL API client (primary provider, per the Phase 0 GO verdict).
//
// Endpoints (verified in the Phase 0 PoC):
//   GET {BASE}/scoreboard?seasontype=2&week={N}   season schedule + scores
//   GET {BASE}/summary?event={eventId}            box score, stats, leaders
//
// Operating notes carried forward from the PoC:
//   - No auth. Polite rate: ~750ms between requests.
//   - ESPN's edge 403s unusual custom User-Agents; use an ordinary browser UA.
//   - Only node built-ins (no new dependencies).
//
// Every fetch returns a *payload* envelope:
//   { provenance: { endpoint, fetched_at, source }, data }
// The checksum used for provider_payloads dedupe is computed over `data` only,
// so re-fetching unchanged provider data is a no-op in the archive.

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const SOURCE = 'ESPN public site API (no auth)';
const POLITE_MS = 750;
const MAX_ATTEMPTS = 3;

// The PoC verdict (POC-REPORT.md): ESPN's edge 403s unusual custom UA strings
// (observed with both a custom bot UA and a bare Chrome string); the default
// python-urllib UA works fine. Use exactly the PoC-verified value.
const USER_AGENT = 'Python-urllib/3.12';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;

async function politeDelay() {
  const wait = POLITE_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function fetchJson(url) {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    await politeDelay();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) {
        throw new Error(`ESPN fetch failed (network) for ${url}: ${err.message}`);
      }
      await sleep(1000 * attempt);
      continue;
    }
    if (res.ok) return res.json();
    // Retry server errors; anything else is a provider-side problem the
    // caller turns into a quarantined/failed sync, not a silent retry loop.
    if (res.status >= 500 && attempt < MAX_ATTEMPTS) {
      await sleep(2000 * attempt);
      continue;
    }
    throw new Error(`ESPN fetch failed: HTTP ${res.status} for ${url}`);
  }
}

function envelope(endpoint, data) {
  return {
    provenance: {
      endpoint,
      fetched_at: new Date().toISOString(),
      source: SOURCE,
    },
    data,
  };
}

/** Scoreboard payload for one regular-season week. */
export async function fetchScoreboard(week, seasonType = 2) {
  const endpoint = `${BASE}/scoreboard?seasontype=${seasonType}&week=${week}`;
  const data = await fetchJson(endpoint);
  return envelope(endpoint, data);
}

/** Full game-detail payload for one ESPN event id. */
export async function fetchSummary(eventId) {
  const endpoint = `${BASE}/summary?event=${eventId}`;
  const data = await fetchJson(endpoint);
  return envelope(endpoint, data);
}

export const ESPN_BASE = BASE;
export const ESPN_SOURCE = SOURCE;
