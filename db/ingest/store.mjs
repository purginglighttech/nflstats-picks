// db/ingest/store.mjs
// Database upserts for the ingestion pipeline. Every write is idempotent on a
// natural key (provider ids, metric keys); re-importing the same provider data
// changes nothing. Schedule/score changes update rows in place — no duplicates.
//
// All functions take a pg Client (or Pool) and manage no transactions
// themselves; the orchestrator (run-week.mjs) sets transaction boundaries.
// Only node built-ins + the `pg` package.

import { createHash } from 'node:crypto';

/** sha256 hex of canonical JSON (object keys sorted recursively). */
export function sha256Hex(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// ---------------------------------------------------------------------------
// provider_payloads (immutable archive index)
// ---------------------------------------------------------------------------

/**
 * Record a provider payload. The checksum covers the provider's `data` only,
 * so re-fetching unchanged data is a no-op; changed data gets a new row and
 * the normalizer upserts over it in place.
 * Returns { id, isNew }.
 */
export async function storePayload(client, {
  provider,
  resourceType,
  providerObjectId,
  season,
  week,
  fetchedAt,
  data,
  rawRef,
}) {
  const checksum = sha256Hex(data);
  const { rows } = await client.query(
    `INSERT INTO provider_payloads
       (provider, resource_type, provider_object_id, season, week,
        fetched_at, checksum, schema_version, raw_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'espn-v1', $8)
     ON CONFLICT (provider, resource_type, provider_object_id, checksum)
     DO NOTHING
     RETURNING id`,
    [provider, resourceType, providerObjectId, season, week, fetchedAt, checksum, rawRef || null]
  );
  if (rows.length > 0) return { id: rows[0].id, isNew: true, checksum };
  const existing = await client.query(
    `SELECT id FROM provider_payloads
     WHERE provider = $1 AND resource_type = $2
       AND provider_object_id = $3 AND checksum = $4`,
    [provider, resourceType, providerObjectId, checksum]
  );
  return { id: existing.rows[0].id, isNew: false, checksum };
}

// ---------------------------------------------------------------------------
// Seasons / weeks / teams
// ---------------------------------------------------------------------------

export async function ensureSeasonWeek(client, seasonYear, weekNumber) {
  const { rows: srows } = await client.query(
    `INSERT INTO seasons (league, year, label)
     VALUES ('NFL', $1, $2)
     ON CONFLICT (league, year) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [seasonYear, `${seasonYear} season`]
  );
  const seasonId = srows[0].id;
  const { rows: wrows } = await client.query(
    `INSERT INTO weeks (season_id, number, label, is_current)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (season_id, number) DO UPDATE SET label = EXCLUDED.label
     RETURNING id`,
    [seasonId, weekNumber, `Week ${weekNumber}`]
  );
  return { seasonId, weekId: wrows[0].id };
}

/**
 * Upsert a team from provider data, idempotent by abbreviation.
 * Curated columns (name, city, conference, division, accents) are only set on
 * insert — a provider refresh never overwrites the seed's curated values; it
 * only fills in the provider team id when missing.
 */
export async function upsertTeam(client, { abbr, name, espnTeamId }) {
  const { rows } = await client.query(
    `INSERT INTO teams (abbreviation, name, city, provider_team_id)
     VALUES ($1, $2, '', $3)
     ON CONFLICT (abbreviation) DO UPDATE SET
       provider_team_id = COALESCE(teams.provider_team_id, EXCLUDED.provider_team_id)
     RETURNING id`,
    [abbr, name, espnTeamId || null]
  );
  return rows[0].id;
}

export async function teamIdsByAbbr(client) {
  const { rows } = await client.query('SELECT id, abbreviation FROM teams');
  return new Map(rows.map((r) => [r.abbreviation, r.id]));
}

// ---------------------------------------------------------------------------
// Games (+ scoring periods, result revisions)
// ---------------------------------------------------------------------------

/**
 * Upsert a game from a normalized scoreboard record. Re-imports update the
 * row in place (kickoff moves, status flips, score corrections); the natural
 * key provider_game_id prevents duplicates.
 * lock_at is always five minutes before scheduled_at (spec).
 */
export async function upsertGame(client, game, sourcePayloadId) {
  const { rows } = await client.query(
    `INSERT INTO games
       (season_id, week_id, provider_game_id, away_team_id, home_team_id,
        scheduled_at, lock_at, status, venue, neutral_site, broadcast_text,
        source_updated_at, ingested_at)
     VALUES (
       (SELECT season_id FROM weeks WHERE id = $1),
       $1, $2, $3, $4, $5,
       $5::timestamptz - interval '5 minutes',
       $6, $7, $8, $9, now(), now()
     )
     ON CONFLICT (provider_game_id) DO UPDATE SET
       scheduled_at  = EXCLUDED.scheduled_at,
       lock_at       = EXCLUDED.scheduled_at - interval '5 minutes',
       status        = EXCLUDED.status,
       venue         = EXCLUDED.venue,
       neutral_site  = EXCLUDED.neutral_site,
       broadcast_text = EXCLUDED.broadcast_text,
       away_team_id  = EXCLUDED.away_team_id,
       home_team_id  = EXCLUDED.home_team_id,
       source_updated_at = now(),
       ingested_at   = now(),
       updated_at    = now()
     RETURNING id`,
    [
      game._weekId,
      game.provider_game_id,
      game._awayTeamId,
      game._homeTeamId,
      game.scheduled_at,
      game.status,
      game.venue,
      game.neutral_site,
      game.broadcast_text,
    ]
  );
  const gameId = rows[0].id;

  if (sourcePayloadId) {
    await client.query(
      `UPDATE games SET ingested_at = now() WHERE id = $1`,
      [gameId]
    );
  }

  // Final games get a versioned result revision (never rewritten in place).
  if (game.status === 'final' && game.home.score !== null && game.away.score !== null) {
    await upsertResultRevision(client, gameId, {
      homeScore: game.home.score,
      awayScore: game.away.score,
      homeTeamId: game._homeTeamId,
      awayTeamId: game._awayTeamId,
    });
  }
  return gameId;
}

/** Versioned final outcomes: new revision on correction, never a rewrite. */
async function upsertResultRevision(client, gameId, { homeScore, awayScore, homeTeamId, awayTeamId }) {
  const { rows: latest } = await client.query(
    `SELECT id, revision_number, home_score, away_score
     FROM game_result_revisions
     WHERE game_id = $1
     ORDER BY revision_number DESC LIMIT 1`,
    [gameId]
  );
  const isTie = homeScore === awayScore;
  const winnerTeamId = isTie ? null : homeScore > awayScore ? homeTeamId : awayTeamId;

  if (latest.length > 0) {
    const cur = latest[0];
    if (cur.home_score === homeScore && cur.away_score === awayScore) return cur.id;
    const { rows } = await client.query(
      `INSERT INTO game_result_revisions
         (game_id, revision_number, home_score, away_score, winner_team_id,
          is_tie, status, correction_reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'corrected', 'provider feed updated the final score')
       RETURNING id`,
      [gameId, cur.revision_number + 1, homeScore, awayScore, winnerTeamId, isTie]
    );
    await client.query('UPDATE games SET result_revision_id = $1 WHERE id = $2', [rows[0].id, gameId]);
    return rows[0].id;
  }

  const { rows } = await client.query(
    `INSERT INTO game_result_revisions
       (game_id, revision_number, home_score, away_score, winner_team_id,
        is_tie, status)
     VALUES ($1, 1, $2, $3, $4, $5, 'official')
     RETURNING id`,
    [gameId, homeScore, awayScore, winnerTeamId, isTie]
  );
  await client.query('UPDATE games SET result_revision_id = $1 WHERE id = $2', [rows[0].id, gameId]);
  return rows[0].id;
}

export async function upsertScoringPeriods(client, gameId, teamIdByAbbr, periods, sourcePayloadId) {
  for (const p of periods) {
    const teamId = teamIdByAbbr.get(p.team_abbr);
    if (!teamId) continue;
    await client.query(
      `INSERT INTO scoring_periods (game_id, team_id, period_number, points, created_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (game_id, team_id, period_number) DO UPDATE SET
         points = EXCLUDED.points`,
      [gameId, teamId, p.period_number, p.points]
    );
  }
  void sourcePayloadId;
}

// ---------------------------------------------------------------------------
// Normalized stat rows
// ---------------------------------------------------------------------------

export async function upsertTeamStats(client, gameIdByRef, teamIdByAbbr, rows, sourcePayloadId) {
  for (const r of rows) {
    const gameId = gameIdByRef.get(r.game_ref);
    const teamId = teamIdByAbbr.get(r.team_abbr);
    if (!gameId || !teamId) continue;
    await client.query(
      `INSERT INTO team_game_stats
         (game_id, team_id, metric_key, display_label, metric_value, unit,
          category, position, display_value, source_payload_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'boxscore', $7, $8, $9)
       ON CONFLICT (game_id, team_id, metric_key) DO UPDATE SET
         display_label = EXCLUDED.display_label,
         metric_value = EXCLUDED.metric_value,
         unit = EXCLUDED.unit,
         position = EXCLUDED.position,
         display_value = EXCLUDED.display_value,
         source_payload_id = EXCLUDED.source_payload_id`,
      [gameId, teamId, r.metric_key, r.display_label, r.metric_value, r.unit,
       r.position, r.display_value, sourcePayloadId || null]
    );
  }
}

export async function upsertPlayerStats(client, gameIdByRef, teamIdByAbbr, rows, sourcePayloadId) {
  void teamIdByAbbr;
  for (const r of rows) {
    const gameId = gameIdByRef.get(r.game_ref);
    if (!gameId) continue;
    await client.query(
      `INSERT INTO player_game_stats
         (game_id, player_external_id, player_name, category_key, metric_key,
          display_label, metric_value, unit, raw_value, source_payload_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (game_id, player_external_id, category_key, metric_key)
       DO UPDATE SET
         player_name = EXCLUDED.player_name,
         display_label = EXCLUDED.display_label,
         metric_value = EXCLUDED.metric_value,
         unit = EXCLUDED.unit,
         raw_value = EXCLUDED.raw_value,
         source_payload_id = EXCLUDED.source_payload_id`,
      [gameId, r.player_external_id, r.player_name, r.category_key, r.metric_key,
       r.metric_key, r.metric_value, null, r.raw_value, sourcePayloadId || null]
    );
  }
}

export async function upsertLeaders(client, gameIdByRef, teamIdByAbbr, rows, sourcePayloadId) {
  for (const r of rows) {
    const gameId = gameIdByRef.get(r.game_ref);
    const teamId = teamIdByAbbr.get(r.team_abbr);
    if (!gameId || !teamId) continue;
    await client.query(
      `INSERT INTO game_leaders
         (game_id, team_id, category_key, category_label, rank,
          player_external_id, player_name, display_value, metric_value,
          source_payload_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (game_id, team_id, category_key, rank) DO UPDATE SET
         category_label = EXCLUDED.category_label,
         player_external_id = EXCLUDED.player_external_id,
         player_name = EXCLUDED.player_name,
         display_value = EXCLUDED.display_value,
         metric_value = EXCLUDED.metric_value,
         source_payload_id = EXCLUDED.source_payload_id`,
      [gameId, teamId, r.category_key, r.category_label, r.rank,
       r.player_external_id, r.player_name, r.display_value, r.metric_value,
       sourcePayloadId || null]
    );
  }
}

/**
 * Replace the active injury list for every *declared* team with the latest
 * declared set. A team present in the provider's injury report with zero
 * entries is declared healthy (old rows deactivated); a team absent from the
 * report is unknown and its stored injuries are left untouched.
 * A missing source status stays NULL (renders N/A, never a status-domain word).
 */
export async function upsertInjuries(client, teamIdByAbbr, injuries, declaredTeamAbbrs) {
  const byTeam = new Map();
  for (const abbr of declaredTeamAbbrs || []) {
    if (!byTeam.has(abbr)) byTeam.set(abbr, []);
  }
  for (const inj of injuries) {
    if (!byTeam.has(inj.team_abbr)) byTeam.set(inj.team_abbr, []);
    byTeam.get(inj.team_abbr).push(inj);
  }
  for (const [abbr, list] of byTeam) {
    const teamId = teamIdByAbbr.get(abbr);
    if (!teamId) continue;
    await client.query(
      `UPDATE team_injury_statuses SET active = false, updated_at = now()
       WHERE team_id = $1 AND active`,
      [teamId]
    );
    for (const inj of list) {
      await client.query(
        `INSERT INTO team_injury_statuses
           (team_id, player_external_id, player_name, injury, status,
            source_updated_at, active)
         VALUES ($1, $2, $3, $4, $5, $6, true)`,
        [teamId, inj.player_external_id, inj.player_name, inj.injury,
         inj.status, inj.source_updated_at]
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Quarantine, sync runs, current-week pointer, digests
// ---------------------------------------------------------------------------

export async function quarantine(client, entries) {
  for (const e of entries) {
    await client.query(
      `INSERT INTO ingest_quarantine
         (provider, resource_type, provider_object_id, reason, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [e.provider, e.resource_type, e.provider_object_id || null,
       e.reason, e.detail ? JSON.stringify(e.detail) : null]
    );
  }
}

export async function recordSyncRun(client, { provider, jobName, season, week }) {
  const { rows } = await client.query(
    `INSERT INTO sync_runs (provider, job_name, status, season, week)
     VALUES ($1, $2, 'running', $3, $4) RETURNING id`,
    [provider, jobName, season || null, week || null]
  );
  return rows[0].id;
}

export async function finishSyncRun(client, id, { status, recordsProcessed, error }) {
  await client.query(
    `UPDATE sync_runs
     SET status = $2, finished_at = now(), records_processed = $3, error = $4
     WHERE id = $1`,
    [id, status, recordsProcessed || 0, error || null]
  );
}

/**
 * Advance the current-week pointer: the earliest week (by kickoff) that still
 * has a non-final game; when every game is final, the latest week with games.
 * Flipping the flag never touches prior weekly pages (spec).
 *
 * Two statements, not one: a single UPDATE flipping two rows trips the
 * partial unique index (one current week per season) mid-statement.
 */
export async function refreshCurrentWeek(client, seasonYear) {
  const { rows } = await client.query(
    `WITH ranked AS (
       SELECT w.id,
              BOOL_AND(g.status = 'final') AS all_final,
              MIN(g.scheduled_at) AS first_kickoff,
              MAX(w.number) AS week_number
       FROM weeks w
       JOIN seasons s ON s.id = w.season_id
       JOIN games g ON g.week_id = w.id
       WHERE s.league = 'NFL' AND s.year = $1
       GROUP BY w.id
     )
     SELECT id FROM ranked
     ORDER BY all_final ASC,
              CASE WHEN all_final THEN -week_number
                   ELSE EXTRACT(EPOCH FROM first_kickoff) END ASC
     LIMIT 1`,
    [seasonYear]
  );
  if (rows.length === 0) return;
  const chosenId = rows[0].id;
  await client.query(
    `UPDATE weeks SET is_current = false, updated_at = now()
     WHERE season_id = (SELECT id FROM seasons WHERE league = 'NFL' AND year = $1)
       AND is_current`,
    [seasonYear]
  );
  await client.query(
    `UPDATE weeks SET is_current = true, updated_at = now() WHERE id = $1`,
    [chosenId]
  );
}

/**
 * Digest of one week's stored data for idempotency verification:
 * per-table counts plus a sha256 over the ordered game rows.
 */
export async function weekDigest(client, seasonYear, weekNumber) {
  const { rows: games } = await client.query(
    `SELECT g.provider_game_id, g.scheduled_at, g.status,
            r.home_score, r.away_score
     FROM games g
     JOIN weeks w ON w.id = g.week_id
     JOIN seasons s ON s.id = w.season_id
     LEFT JOIN game_result_revisions r ON r.id = g.result_revision_id
     WHERE s.league = 'NFL' AND s.year = $1 AND w.number = $2
     ORDER BY g.provider_game_id`,
    [seasonYear, weekNumber]
  );
  const counts = {};
  for (const [table, join] of [
    ['team_game_stats', ''],
    ['player_game_stats', ''],
    ['scoring_periods', ''],
    ['game_leaders', ''],
  ]) {
    void join;
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM ${table} t
       JOIN games g ON g.id = t.game_id
       JOIN weeks w ON w.id = g.week_id
       JOIN seasons s ON s.id = w.season_id
       WHERE s.league = 'NFL' AND s.year = $1 AND w.number = $2`,
      [seasonYear, weekNumber]
    );
    counts[table] = rows[0].n;
  }
  counts.games = games.length;
  const digest = sha256Hex(
    games.map((g) =>
      [g.provider_game_id, g.scheduled_at, g.status, g.home_score, g.away_score].join('|')
    )
  );
  return { counts, digest };
}
