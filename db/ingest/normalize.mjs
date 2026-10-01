// db/ingest/normalize.mjs
// Pure normalization: ESPN provider payloads -> database-ready records.
//
// Port of the Phase 0 PoC's normalize.py, hardened for production:
//   - displayValue is the source of truth (ESPN's numeric `value` is "-" for
//     several stats — PoC finding).
//   - Compound display strings ("23/33", "3-10", "5-16") are split into
//     explicit sub-metrics via the SPLIT tables below; nothing is guessed.
//   - Anything that cannot be normalized is reported as a quarantine entry
//     instead of throwing: invalid data must never partially mutate
//     competition facts (spec: ingestion contract).
//
// No I/O, no database access. Callers pass a `quarantines` array; entries
// have { provider, resource_type, provider_object_id, reason, detail }.

/** Canonical team abbreviations (mirrors NflTeamSchema in @pickem/contracts). */
export const NFL_TEAMS = new Set([
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET',
  'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA', 'MIN', 'NE',
  'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS',
]);

/**
 * Provider team codes -> canonical abbreviations. ESPN still uses its legacy
 * "WSH" code for Washington in scoreboard payloads (observed 2026-10-01);
 * the platform canonical is "WAS" (contracts + seed).
 */
const ESPN_TEAM_CODE_MAP = { WSH: 'WAS' };

/** Map a provider team code to the canonical abbreviation. */
export function canonicalTeamAbbr(code) {
  if (!code) return code;
  const c = String(code).trim().toUpperCase();
  return ESPN_TEAM_CODE_MAP[c] || c;
}

/** ESPN scoreboard state -> games.status. */
const STATUS_MAP = { pre: 'scheduled', in: 'live', post: 'final' };

/**
 * Compound team-stat display values, split into explicit sub-metrics.
 * Key: ESPN statistic name. Value: [first metric_key, second metric_key].
 * Labels come from ESPN ("Red Zone (Made-Att)", "Sacks-Yards Lost", ...).
 */
const TEAM_COMPOUND_SPLITS = {
  completionAttempts: ['completions', 'attempts'],
  thirdDownEff: ['third_down_conversions', 'third_down_attempts'],
  fourthDownEff: ['fourth_down_conversions', 'fourth_down_attempts'],
  redZoneAttempts: ['red_zone_scores', 'red_zone_attempts'],
  sacksYardsLost: ['sacks', 'sack_yards_lost'],
  totalPenaltiesYards: ['penalties', 'penalty_yards'],
};

/**
 * Compound player-stat keys, split into explicit sub-metrics.
 * ESPN joins the two parts with "/" or "-".
 */
const PLAYER_COMPOUND_SPLITS = {
  'completions/passingAttempts': ['passing_completions', 'passing_attempts'],
  'sacks-sackYardsLost': ['sacks', 'sack_yards_lost'],
  'fieldGoalsMade/fieldGoalAttempts': ['field_goals_made', 'field_goal_attempts'],
  'extraPointsMade/extraPointAttempts': ['extra_points_made', 'extra_point_attempts'],
};

/** Recognized "no data" tokens: stored as NULL, never quarantined. */
export function isNullToken(displayValue) {
  if (displayValue === null || displayValue === undefined) return true;
  const s = String(displayValue).trim();
  return s === '' || s === '-' || s === '–' || s === '--';
}

/** Parse a plain numeric display string; null when it isn't one. */
export function parseNumeric(displayValue) {
  if (isNullToken(displayValue)) return null;
  const s = String(displayValue).trim().replace(/,/g, '');
  const pct = s.endsWith('%');
  const num = Number(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(num)) return null;
  return num;
}

/** Unit hint from the display string: percent or nothing (boring default). */
export function inferUnit(displayValue) {
  const s = String(displayValue ?? '').trim();
  return s.endsWith('%') ? 'percent' : null;
}

/** Split "A/B", "A-B" (not a range) into [A, B]; null otherwise. */
export function splitCompound(displayValue) {
  const s = String(displayValue ?? '').trim();
  const m = s.match(/^(\d+)\s*[/-]\s*(\d+)$/);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** "MM:SS" -> seconds; null otherwise. */
export function parsePossessionTime(displayValue) {
  const m = String(displayValue ?? '').trim().match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function pushQuarantine(quarantines, entry) {
  quarantines.push(entry);
}

function checkTeamAbbr(abbr, quarantines, resourceType, objectId, context) {
  if (!abbr || !NFL_TEAMS.has(abbr)) {
    pushQuarantine(quarantines, {
      provider: 'espn',
      resource_type: resourceType,
      provider_object_id: objectId,
      reason: `unknown team abbreviation ${JSON.stringify(abbr)} in ${context}`,
      detail: { abbreviation: abbr, context },
    });
    return false;
  }
  return true;
}

function parseScore(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Scoreboard -> game record (+ scoring periods)
// ---------------------------------------------------------------------------

/**
 * Normalize one scoreboard event into a game record.
 * Returns null (and quarantines) when the event cannot be normalized.
 */
export function normalizeScoreboardEvent(ev, quarantines) {
  const eventId = ev && ev.id;
  const comp = ev && ev.competitions && ev.competitions[0];
  if (!comp) {
    pushQuarantine(quarantines, {
      provider: 'espn',
      resource_type: 'scoreboard_event',
      provider_object_id: eventId ? String(eventId) : null,
      reason: 'event has no competition data',
      detail: null,
    });
    return null;
  }

  const state = comp.status && comp.status.type && comp.status.type.state;
  const status = STATUS_MAP[state];
  if (!status) {
    pushQuarantine(quarantines, {
      provider: 'espn',
      resource_type: 'scoreboard_event',
      provider_object_id: String(eventId),
      reason: `unknown status state ${JSON.stringify(state)}`,
      detail: { state },
    });
    return null;
  }

  const sides = {};
  for (const c of comp.competitors || []) {
    const abbr = canonicalTeamAbbr(c.team && c.team.abbreviation);
    if (!checkTeamAbbr(abbr, quarantines, 'scoreboard_event', String(eventId), 'competitors')) {
      return null;
    }
    sides[c.homeAway] = {
      abbr,
      name: c.team.displayName,
      espn_team_id: String(c.team.id),
      score: parseScore(c.score),
      winner: c.winner === true,
      linescores: (c.linescores || []).map((ls, i) => ({
        period: i + 1,
        points: parseScore(ls.value) ?? 0,
      })),
    };
  }
  if (!sides.home || !sides.away) {
    pushQuarantine(quarantines, {
      provider: 'espn',
      resource_type: 'scoreboard_event',
      provider_object_id: String(eventId),
      reason: 'event is missing a home or away competitor',
      detail: { sides: Object.keys(sides) },
    });
    return null;
  }

  const broadcast = comp.broadcast;
  return {
    provider_game_id: `espn:${eventId}`,
    season_year: ev.season && ev.season.year,
    season_type: ev.season && ev.season.type,
    week_number: ev.week && ev.week.number,
    scheduled_at: comp.date,
    status,
    venue: (comp.venue && comp.venue.fullName) || null,
    neutral_site: comp.neutralSite === true,
    broadcast_text: typeof broadcast === 'string' ? broadcast : null,
    home: sides.home,
    away: sides.away,
  };
}

/** Scoring periods from a normalized game record's linescores. */
export function scoringPeriods(game) {
  const rows = [];
  for (const [side, team] of [['home', game.home], ['away', game.away]]) {
    for (const ls of team.linescores) {
      rows.push({
        game_ref: game.provider_game_id,
        team_abbr: team.abbr,
        period_number: ls.period,
        points: ls.points,
        _side: side,
      });
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Summary -> team stats, player stats, leaders, injuries
// ---------------------------------------------------------------------------

/** Normalize one team-statistics entry (may yield 0, 1, or 2 rows). */
function normalizeTeamStat(gameRef, teamAbbr, stat, position, quarantines, eventId) {
  const rows = [];
  const displayValue = stat.displayValue;
  const label = stat.label || stat.name;

  if (stat.name === 'possessionTime') {
    const seconds = parsePossessionTime(displayValue);
    if (seconds === null) {
      pushQuarantine(quarantines, {
        provider: 'espn', resource_type: 'team_stat', provider_object_id: String(eventId),
        reason: `unparseable possessionTime ${JSON.stringify(displayValue)}`,
        detail: { team: teamAbbr, stat: stat.name, displayValue },
      });
      return rows;
    }
    rows.push({
      game_ref: gameRef, team_abbr: teamAbbr, metric_key: stat.name,
      display_label: label, metric_value: seconds, display_value: String(displayValue),
      unit: 'seconds', position,
    });
    return rows;
  }

  const split = TEAM_COMPOUND_SPLITS[stat.name];
  if (split) {
    const parts = splitCompound(displayValue);
    if (!parts) {
      // A null token means "no data" (not an anomaly); anything else that
      // fails to split is quarantined.
      if (!isNullToken(displayValue)) {
        pushQuarantine(quarantines, {
          provider: 'espn', resource_type: 'team_stat', provider_object_id: String(eventId),
          reason: `unparseable compound team stat ${JSON.stringify(displayValue)}`,
          detail: { team: teamAbbr, stat: stat.name, displayValue },
        });
      }
      return rows;
    }
    split.forEach((metricKey, i) => {
      rows.push({
        game_ref: gameRef, team_abbr: teamAbbr, metric_key: metricKey,
        display_label: `${label} (${i === 0 ? 'first' : 'second'} of ${displayValue})`,
        metric_value: parts[i], display_value: String(displayValue),
        unit: null, position,
      });
    });
    return rows;
  }

  const value = parseNumeric(displayValue);
  if (value === null && !isNullToken(displayValue)) {
    pushQuarantine(quarantines, {
      provider: 'espn', resource_type: 'team_stat', provider_object_id: String(eventId),
      reason: `unparseable team stat value ${JSON.stringify(displayValue)}`,
      detail: { team: teamAbbr, stat: stat.name, displayValue },
    });
  }
  rows.push({
    game_ref: gameRef, team_abbr: teamAbbr, metric_key: stat.name,
    display_label: label, metric_value: value,
    display_value: displayValue === null ? null : String(displayValue),
    unit: inferUnit(displayValue), position,
  });
  return rows;
}

/** Normalize one player-stat line into metric rows. */
function normalizePlayerStat(gameRef, teamAbbr, category, athlete, quarantines, eventId) {
  const rows = [];
  const keys = category.keys || [];
  const values = athlete.stats || [];
  const person = athlete.athlete || {};
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const raw = values[i];
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const split = PLAYER_COMPOUND_SPLITS[key];
    if (split) {
      const parts = splitCompound(raw);
      if (!parts) {
        pushQuarantine(quarantines, {
          provider: 'espn', resource_type: 'player_stat', provider_object_id: String(eventId),
          reason: `unparseable compound player stat ${JSON.stringify(raw)}`,
          detail: { team: teamAbbr, category: category.name, key, athlete: person.displayName },
        });
        continue;
      }
      split.forEach((metricKey, j) => {
        rows.push({
          game_ref: gameRef, team_abbr: teamAbbr,
          player_external_id: `espn:${person.id}`,
          player_name: person.displayName || null,
          category_key: category.name, metric_key: metricKey,
          metric_value: parts[j], raw_value: String(raw),
        });
      });
      continue;
    }
    const value = parseNumeric(raw);
    if (value === null && !isNullToken(raw)) {
      pushQuarantine(quarantines, {
        provider: 'espn', resource_type: 'player_stat', provider_object_id: String(eventId),
        reason: `unparseable player stat value ${JSON.stringify(raw)}`,
        detail: { team: teamAbbr, category: category.name, key, athlete: person.displayName },
      });
    }
    rows.push({
      game_ref: gameRef, team_abbr: teamAbbr,
      player_external_id: `espn:${person.id}`,
      player_name: person.displayName || null,
      category_key: category.name, metric_key: key,
      metric_value: value, raw_value: String(raw),
    });
  }
  return rows;
}

/**
 * Normalize a summary payload's data section.
 * Scheduled (pre-game) summaries have no boxscore; that is normal, not an error.
 */
export function normalizeSummary(eventId, data, quarantines) {
  const gameRef = `espn:${eventId}`;
  const teamStats = [];
  const playerStats = [];
  const leaders = [];
  const injuries = [];
  // Teams the provider actually reported on (even with zero entries).
  // A reported team with no injuries is declared healthy; a team absent
  // from the section is unknown and its stored injuries stay untouched.
  const injuryTeams = [];

  const box = data.boxscore || {};
  for (const t of box.teams || []) {
    const rawAbbr = t.team && t.team.abbr ? t.team.abbr : t.team && t.team.abbreviation;
    const abbr = canonicalTeamAbbr(rawAbbr);
    if (!checkTeamAbbr(abbr, quarantines, 'game_summary', String(eventId), 'boxscore.teams')) continue;
    (t.statistics || []).forEach((s, i) => {
      teamStats.push(...normalizeTeamStat(gameRef, abbr, s, i, quarantines, eventId));
    });
  }

  for (const pb of box.players || []) {
    const abbr = canonicalTeamAbbr(pb.team && (pb.team.abbr || pb.team.abbreviation));
    if (!checkTeamAbbr(abbr, quarantines, 'game_summary', String(eventId), 'boxscore.players')) continue;
    for (const cat of pb.statistics || []) {
      for (const a of cat.athletes || []) {
        playerStats.push(...normalizePlayerStat(gameRef, abbr, cat, a, quarantines, eventId));
      }
    }
  }

  for (const lg of data.leaders || []) {
    const abbr = canonicalTeamAbbr(lg.team && (lg.team.abbr || lg.team.abbreviation));
    if (!checkTeamAbbr(abbr, quarantines, 'game_summary', String(eventId), 'leaders')) continue;
    for (const cat of lg.leaders || []) {
      (cat.leaders || []).forEach((l, i) => {
        const person = l.athlete || {};
        leaders.push({
          game_ref: gameRef, team_abbr: abbr,
          category_key: cat.name || cat.displayName,
          category_label: cat.displayName || cat.name,
          rank: i + 1,
          player_external_id: person.id ? `espn:${person.id}` : null,
          player_name: person.displayName || person.fullName || null,
          display_value: l.displayValue || null,
          metric_value: typeof l.value === 'number' ? l.value : parseNumeric(l.displayValue),
        });
      });
    }
  }

  for (const inj of data.injuries || []) {
    const abbr = canonicalTeamAbbr(inj.team && (inj.team.abbr || inj.team.abbreviation));
    if (!checkTeamAbbr(abbr, quarantines, 'game_summary', String(eventId), 'injuries')) continue;
    injuryTeams.push(abbr);
    for (const entry of inj.injuries || []) {
      const person = entry.athlete || {};
      const details = entry.details || {};
      injuries.push({
        team_abbr: abbr,
        player_external_id: `espn:${person.id}`,
        player_name: person.displayName || person.fullName || null,
        // Missing source status stays NULL; the product renders N/A (spec).
        injury: details.type || (entry.type && entry.type.description) || null,
        status: entry.status || null,
        source_updated_at: entry.date || null,
      });
    }
  }

  return { teamStats, playerStats, leaders, injuries, injuryTeams };
}
