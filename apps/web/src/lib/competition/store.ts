/**
 * Phase 3 competition store: picks, reveal, standings.
 *
 * Server-only. All SQL is parameterized; game lock deadlines are enforced
 * against the database server's clock (`now()`), never the client's.
 *
 * Conventions (from sibling modules):
 * - team IDs on the wire are canonical abbreviations (contracts NflTeam);
 *   the DB stores uuid FKs — every query maps via the teams table.
 * - display identity comes from profiles.display_name; email is never
 *   exposed by competition reads.
 */
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { query, queryOne, withTransaction } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Typed domain errors (routes map these to status codes)              */
/* ------------------------------------------------------------------ */

export class GameNotFoundError extends Error {}
export class PickLockedError extends Error {}
export class NotPoolMemberError extends Error {}
export class IdempotencyConflictError extends Error {}
export class InvalidPickTeamError extends Error {}

export interface GameRow {
  id: string;
  status: string;
  lock_at: string;
  season_id: string;
  week_id: string;
  home_abbr: string;
  away_abbr: string;
}

async function loadGame(
  client: PoolClient,
  gameId: string,
  forUpdate: boolean,
): Promise<GameRow | undefined> {
  const { rows } = await client.query(
    `SELECT g.id, g.status, g.lock_at, g.season_id, g.week_id,
            ht.abbreviation AS home_abbr, at.abbreviation AS away_abbr
     FROM games g
     JOIN teams ht ON ht.id = g.home_team_id
     JOIN teams at ON at.id = g.away_team_id
     WHERE g.id = $1
     ${forUpdate ? "FOR UPDATE" : ""}`,
    [gameId],
  );
  return rows[0] as GameRow | undefined;
}

/** Active membership in the global pool (the beta invite list). */
export async function isPoolMember(
  client: PoolClient,
  userId: string,
): Promise<boolean> {
  const row = await client.query(
    `SELECT 1
     FROM memberships m
     JOIN pools p ON p.id = m.pool_id
     WHERE p.is_global AND m.user_id = $1 AND m.status = 'active'
     LIMIT 1`,
    [userId],
  );
  return row.rowCount === 1;
}

/**
 * Eligible participants for a game: active global-pool members whose
 * membership predates the game's lock_at. This is the reveal denominator.
 */
export async function eligibleParticipantCount(
  client: PoolClient,
  lockAt: string,
): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
     FROM memberships m
     JOIN pools p ON p.id = m.pool_id
     WHERE p.is_global AND m.status = 'active' AND m.created_at <= $1`,
    [lockAt],
  );
  return (rows[0] as { n: number }).n;
}

export interface SavedPick {
  game_id: string;
  selected_team_id: string;
  saved_at: string;
  revision: number;
  locked: boolean;
}

function requestHash(selectedTeamAbbr: string): string {
  return createHash("sha256").update(`pick:${selectedTeamAbbr}`, "utf8").digest("hex");
}

/**
 * Save or revise a pick. Implements the spec's request path for a pick:
 * authenticate (done by the route), load game + pick rows, reject when the
 * server clock is at or past lock_at or the game is no longer scheduled,
 * upsert the editable pick, and append the revision log.
 *
 * Idempotency: the same key + same payload replays the stored result without
 * a new revision; the same key + a different payload is a 409.
 */
export async function savePick(input: {
  userId: string;
  gameId: string;
  selectedTeamAbbr: string;
  idempotencyKey: string;
}): Promise<SavedPick> {
  return withTransaction(async (client) => {
    const game = await loadGame(client, input.gameId, true);
    if (!game) throw new GameNotFoundError(`No such game: ${input.gameId}.`);

    // Server-time lock check: the single authority on the deadline.
    const lockCheck = await client.query(
      `SELECT (now() >= $1) AS locked, ($2 <> 'scheduled') AS not_scheduled`,
      [game.lock_at, game.status],
    );
    const { locked, not_scheduled } = lockCheck.rows[0] as {
      locked: boolean;
      not_scheduled: boolean;
    };
    if (locked || not_scheduled) {
      throw new PickLockedError(
        "This game is locked. Picks close five minutes before kickoff.",
      );
    }

    if (!(await isPoolMember(client, input.userId))) {
      throw new NotPoolMemberError(
        "Only members of the competition pool can save picks.",
      );
    }

    if (
      input.selectedTeamAbbr !== game.home_abbr &&
      input.selectedTeamAbbr !== game.away_abbr
    ) {
      throw new InvalidPickTeamError(
        `${input.selectedTeamAbbr} is not playing in this game.`,
      );
    }

    const hash = requestHash(input.selectedTeamAbbr);
    const existingKey = await client.query(
      `SELECT pick_id, request_hash FROM pick_idempotency_keys
       WHERE user_id = $1 AND game_id = $2 AND idempotency_key = $3`,
      [input.userId, input.gameId, input.idempotencyKey],
    );
    if (existingKey.rowCount === 1) {
      const row = existingKey.rows[0] as { pick_id: string; request_hash: string };
      if (row.request_hash !== hash) {
        throw new IdempotencyConflictError(
          "This idempotency key was already used for a different pick.",
        );
      }
      // Replay: return the current pick without writing a new revision.
      const replay = await loadPickShape(client, input.userId, input.gameId);
      if (!replay) throw new GameNotFoundError("Pick vanished mid-replay.");
      return replay;
    }

    const teamRow = await client.query(
      `SELECT id FROM teams WHERE abbreviation = $1`,
      [input.selectedTeamAbbr],
    );
    const teamId = (teamRow.rows[0] as { id: string }).id;

    const existingPick = await client.query(
      `SELECT id, committed_at FROM picks WHERE user_id = $1 AND game_id = $2 FOR UPDATE`,
      [input.userId, input.gameId],
    );
    if (existingPick.rowCount === 1) {
      const row = existingPick.rows[0] as { id: string; committed_at: string | null };
      if (row.committed_at !== null) {
        // Belt and suspenders: the lock check above already rejected this.
        throw new PickLockedError("This pick is already locked.");
      }
      await client.query(
        `UPDATE picks SET selected_team_id = $1, updated_at = now()
         WHERE id = $2`,
        [teamId, row.id],
      );
      const revision = await appendPickRevision(client, row.id, teamId);
      await client.query(
        `INSERT INTO pick_idempotency_keys
           (user_id, game_id, idempotency_key, pick_id, request_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.gameId, input.idempotencyKey, row.id, hash],
      );
      return shapePick(client, input.gameId, input.selectedTeamAbbr, row.id, revision);
    }

    const inserted = await client.query(
      `INSERT INTO picks (user_id, game_id, selected_team_id)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [input.userId, input.gameId, teamId],
    );
    const pickId = (inserted.rows[0] as { id: string }).id;
    const revision = await appendPickRevision(client, pickId, teamId);
    await client.query(
      `INSERT INTO pick_idempotency_keys
         (user_id, game_id, idempotency_key, pick_id, request_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [input.userId, input.gameId, input.idempotencyKey, pickId, hash],
    );
    return shapePick(client, input.gameId, input.selectedTeamAbbr, pickId, revision);
  });
}

async function appendPickRevision(
  client: PoolClient,
  pickId: string,
  teamId: string,
): Promise<number> {
  const { rows } = await client.query(
    `INSERT INTO pick_revisions (pick_id, revision_number, selected_team_id)
     SELECT $1, COALESCE(MAX(revision_number), 0) + 1, $2
     FROM pick_revisions WHERE pick_id = $1
     RETURNING revision_number`,
    [pickId, teamId],
  );
  return (rows[0] as { revision_number: number }).revision_number;
}

async function shapePick(
  client: PoolClient,
  gameId: string,
  selectedTeamAbbr: string,
  pickId: string,
  revision: number,
): Promise<SavedPick> {
  const { rows } = await client.query(
    `SELECT p.updated_at AS saved_at, (now() >= g.lock_at) AS locked
     FROM picks p JOIN games g ON g.id = p.game_id
     WHERE p.id = $1`,
    [pickId],
  );
  const row = rows[0] as { saved_at: string; locked: boolean };
  return {
    game_id: gameId,
    selected_team_id: selectedTeamAbbr,
    saved_at: new Date(row.saved_at).toISOString(),
    revision,
    locked: row.locked,
  };
}

async function loadPickShape(
  client: PoolClient,
  userId: string,
  gameId: string,
): Promise<SavedPick | null> {
  const { rows } = await client.query(
    `SELECT p.id, t.abbreviation AS selected_team_id, p.updated_at AS saved_at,
            (now() >= g.lock_at) AS locked,
            (SELECT COALESCE(MAX(revision_number), 0) FROM pick_revisions pr
             WHERE pr.pick_id = p.id) AS revision
     FROM picks p
     JOIN teams t ON t.id = p.selected_team_id
     JOIN games g ON g.id = p.game_id
     WHERE p.user_id = $1 AND p.game_id = $2`,
    [userId, gameId],
  );
  if (rows.length === 0) return null;
  const r = rows[0] as {
    id: string;
    selected_team_id: string;
    saved_at: string;
    locked: boolean;
    revision: number;
  };
  return {
    game_id: gameId,
    selected_team_id: r.selected_team_id,
    saved_at: new Date(r.saved_at).toISOString(),
    revision: r.revision,
    locked: r.locked,
  };
}

/** The member's own saved pick for one game (owner-only). */
export async function getOwnPick(
  userId: string,
  gameId: string,
): Promise<SavedPick | null> {
  return withTransaction(async (client) => loadPickShape(client, userId, gameId));
}

/** The member's own saved picks for every game of a week (owner-only). */
export async function getWeekPicks(userId: string, weekId: string): Promise<SavedPick[]> {
  const { rows } = await query<{
    game_id: string;
    selected_team_id: string;
    saved_at: string;
    locked: boolean;
    revision: number;
  }>(
    `SELECT p.game_id, t.abbreviation AS selected_team_id,
            p.updated_at AS saved_at, (now() >= g.lock_at) AS locked,
            (SELECT COALESCE(MAX(revision_number), 0) FROM pick_revisions pr
             WHERE pr.pick_id = p.id) AS revision
     FROM picks p
     JOIN teams t ON t.id = p.selected_team_id
     JOIN games g ON g.id = p.game_id
     WHERE p.user_id = $1 AND g.week_id = $2
     ORDER BY g.scheduled_at`,
    [userId, weekId],
  );
  return rows.map((r) => ({
    game_id: r.game_id,
    selected_team_id: r.selected_team_id,
    saved_at: new Date(r.saved_at).toISOString(),
    revision: r.revision,
    locked: r.locked,
  }));
}

/* ------------------------------------------------------------------ */
/* Reveal (post-lock only)                                             */
/* ------------------------------------------------------------------ */

export interface RevealTeam {
  team_id: string;
  pick_count: number;
  share: number;
}

export interface RevealSummary {
  game_id: string;
  locked: true;
  teams: [RevealTeam, RevealTeam];
  total_picks: number;
  eligible_participants: number;
}

/**
 * Post-lock reveal summary: committed counts + share of ALL eligible
 * participants per team, with the explicit denominator. Throws
 * PickLockedError when the game has not locked yet (the summary is sealed
 * pre-lock — the viewer gate).
 */
export async function getRevealSummary(gameId: string): Promise<RevealSummary> {
  return withTransaction(async (client) => {
    const game = await loadGame(client, gameId, false);
    if (!game) throw new GameNotFoundError(`No such game: ${gameId}.`);
    const { rows: lockRows } = await client.query(
      `SELECT (now() >= $1) AS locked`,
      [game.lock_at],
    );
    if (!(lockRows[0] as { locked: boolean }).locked) {
      throw new PickLockedError("Picks for this game are still sealed.");
    }

    const { rows: countRows } = await client.query(
      `SELECT t.abbreviation AS team_id, count(*)::int AS pick_count
       FROM picks p
       JOIN teams t ON t.id = p.selected_team_id
       WHERE p.game_id = $1 AND p.committed_at IS NOT NULL
       GROUP BY t.abbreviation`,
      [gameId],
    );
    const counts = new Map(
      (countRows as { team_id: string; pick_count: number }[]).map((r) => [
        r.team_id,
        r.pick_count,
      ]),
    );
    const eligible = await eligibleParticipantCount(client, game.lock_at);
    const away = counts.get(game.away_abbr) ?? 0;
    const home = counts.get(game.home_abbr) ?? 0;
    const share = (n: number) => (eligible === 0 ? 0 : n / eligible);
    return {
      game_id: gameId,
      locked: true as const,
      teams: [
        { team_id: game.away_abbr, pick_count: away, share: share(away) },
        { team_id: game.home_abbr, pick_count: home, share: share(home) },
      ],
      total_picks: away + home,
      eligible_participants: eligible,
    };
  });
}

export interface RevealParticipant {
  user_id: string;
  display_name: string;
}

export interface RevealParticipantList {
  game_id: string;
  team_id: string;
  participants: RevealParticipant[];
  total: number;
  next_cursor: string | null;
}

/**
 * Post-lock team-detail: every revealed participant who picked the team.
 * Only the requested team's list is ever returned (never the other side,
 * never non-pickers). Cursor is an opaque decimal offset.
 */
export async function getRevealParticipants(
  gameId: string,
  teamAbbr: string,
  limit: number,
  cursor?: string,
): Promise<RevealParticipantList> {
  return withTransaction(async (client) => {
    const game = await loadGame(client, gameId, false);
    if (!game) throw new GameNotFoundError(`No such game: ${gameId}.`);
    if (teamAbbr !== game.home_abbr && teamAbbr !== game.away_abbr) {
      throw new InvalidPickTeamError(`${teamAbbr} is not playing in this game.`);
    }
    const { rows: lockRows } = await client.query(
      `SELECT (now() >= $1) AS locked`,
      [game.lock_at],
    );
    if (!(lockRows[0] as { locked: boolean }).locked) {
      throw new PickLockedError("Picks for this game are still sealed.");
    }

    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) {
      throw new InvalidPickTeamError("Invalid pagination cursor.");
    }

    const { rows: totalRows } = await client.query(
      `SELECT count(*)::int AS n
       FROM picks p
       JOIN teams t ON t.id = p.selected_team_id
       WHERE p.game_id = $1 AND t.abbreviation = $2 AND p.committed_at IS NOT NULL`,
      [gameId, teamAbbr],
    );
    const total = (totalRows[0] as { n: number }).n;

    const { rows } = await client.query(
      `SELECT p.user_id, pr.display_name
       FROM picks p
       JOIN teams t ON t.id = p.selected_team_id
       JOIN profiles pr ON pr.user_id = p.user_id
       WHERE p.game_id = $1 AND t.abbreviation = $2 AND p.committed_at IS NOT NULL
       ORDER BY pr.display_name ASC, p.user_id ASC
       LIMIT $3 OFFSET $4`,
      [gameId, teamAbbr, limit + 1, offset],
    );
    const page = (
      rows as { user_id: string; display_name: string }[]
    ).slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      game_id: gameId,
      team_id: teamAbbr,
      participants: page,
      total,
      next_cursor: hasMore ? String(offset + limit) : null,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Standings                                                           */
/* ------------------------------------------------------------------ */

export interface StandingRow {
  user_id: string;
  display_name: string;
  wins: number;
  losses: number;
  ties: number;
  misses: number;
  updated_at: string;
}

/** Weekly standings source rows, ordered by the spec's rank inputs. */
export async function getWeeklyStandingRows(weekId: string): Promise<StandingRow[]> {
  const { rows } = await query<StandingRow>(
    `SELECT u.id AS user_id, pr.display_name,
            ws.win_count AS wins, ws.loss_count AS losses,
            ws.tie_count AS ties, ws.miss_count AS misses,
            ws.updated_at
     FROM weekly_scores ws
     JOIN users u ON u.id = ws.user_id
     JOIN profiles pr ON pr.user_id = u.id
     WHERE ws.week_id = $1`,
    [weekId],
  );
  return rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}

/** Season standings source rows: weekly projections summed. */
export async function getSeasonStandingRows(seasonYear: number): Promise<StandingRow[]> {
  const { rows } = await query<StandingRow>(
    `SELECT u.id AS user_id, pr.display_name,
            SUM(ws.win_count)::int AS wins, SUM(ws.loss_count)::int AS losses,
            SUM(ws.tie_count)::int AS ties, SUM(ws.miss_count)::int AS misses,
            MAX(ws.updated_at) AS updated_at
     FROM weekly_scores ws
     JOIN users u ON u.id = ws.user_id
     JOIN profiles pr ON pr.user_id = u.id
     JOIN weeks w ON w.id = ws.week_id
     JOIN seasons s ON s.id = w.season_id
     WHERE s.league = 'NFL' AND s.year = $1
     GROUP BY u.id, pr.display_name`,
    [seasonYear],
  );
  return rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}

/** Resolve a season by year or uuid. */
export async function getSeasonByRef(ref: string): Promise<{ id: string; year: number } | undefined> {
  if (/^\d{4}$/.test(ref)) {
    return queryOne<{ id: string; year: number }>(
      `SELECT id, year FROM seasons WHERE league = 'NFL' AND year = $1`,
      [Number(ref)],
    );
  }
  return queryOne<{ id: string; year: number }>(
    `SELECT id, year FROM seasons WHERE id = $1`,
    [ref],
  );
}
