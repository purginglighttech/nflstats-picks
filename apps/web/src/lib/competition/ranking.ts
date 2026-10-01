/**
 * Pure standings math (Phase 3). No I/O — unit-tested.
 *
 * Spec, "Records and rankings":
 * - Weekly record is W-L-T; losses include incorrect saved picks AND misses.
 * - Accuracy = W / (W + L); misses count as losses; ties excluded.
 *   Null when W + L is zero (renders as an em dash, never zero).
 * - Rank order: (1) most correct picks, (2) highest accuracy,
 *   (3) most completed eligible picks (graded non-void outcomes),
 *   (4) shared rank when still tied — standard competition ranking
 *   (1, 2, 2, 4).
 * - "Games behind" = leader's correct-pick total minus the participant's.
 *   Never fractional.
 */

export interface RankInput {
  wins: number;
  losses: number;
  ties: number;
  misses: number;
}

/** W / (W + L); null when W + L = 0. Misses already count as losses. */
export function accuracyOf(row: { wins: number; losses: number }): number | null {
  const denom = row.wins + row.losses;
  if (denom === 0) return null;
  return row.wins / denom;
}

/** Graded, non-void outcomes: tie-break #3. Misses are not completed picks. */
export function completedPicksOf(row: {
  wins: number;
  losses: number;
  ties: number;
}): number {
  return row.wins + row.losses + row.ties;
}

export interface RankedRow<T extends RankInput> {
  row: T;
  accuracy: number | null;
  completed: number;
  rank: number;
  games_behind: number;
}

/**
 * Order rows by the spec's rank inputs and assign standard competition
 * ranks. Ties are broken deterministically by display name for a stable
 * order (the rank itself is shared).
 */
export function rankStandings<T extends RankInput & { display_name: string }>(
  rows: T[],
): RankedRow<T>[] {
  const enriched = rows.map((row) => ({
    row,
    accuracy: accuracyOf(row),
    completed: completedPicksOf(row),
  }));

  enriched.sort((a, b) => {
    if (b.row.wins !== a.row.wins) return b.row.wins - a.row.wins;
    const accA = a.accuracy ?? -1;
    const accB = b.accuracy ?? -1;
    if (accB !== accA) return accB - accA;
    if (b.completed !== a.completed) return b.completed - a.completed;
    return a.row.display_name.localeCompare(b.row.display_name);
  });

  const leaderWins = enriched.length > 0 ? enriched[0].row.wins : 0;
  const out: RankedRow<T>[] = [];
  let lastKey: string | null = null;
  let lastRank = 0;
  for (let i = 0; i < enriched.length; i++) {
    const e = enriched[i];
    // Rank inputs only (not the display-name tiebreak): equal inputs share rank.
    const key = `${e.row.wins}|${e.accuracy ?? "null"}|${e.completed}`;
    const rank = key === lastKey ? lastRank : i + 1;
    lastKey = key;
    lastRank = rank;
    out.push({
      ...e,
      rank,
      games_behind: leaderWins - e.row.wins,
    });
  }
  return out;
}
