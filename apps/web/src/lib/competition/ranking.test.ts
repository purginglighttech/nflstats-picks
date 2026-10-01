import { describe, expect, it } from "vitest";
import {
  accuracyOf,
  completedPicksOf,
  rankStandings,
} from "./ranking";

const row = (
  display_name: string,
  wins: number,
  losses: number,
  ties = 0,
  misses = 0,
) => ({ display_name, wins, losses, ties, misses });

describe("accuracyOf", () => {
  it("is W / (W + L) with misses already counted as losses", () => {
    expect(accuracyOf({ wins: 3, losses: 1 })).toBeCloseTo(0.75);
  });

  it("is null when W + L is zero — renders as an em dash, never zero", () => {
    expect(accuracyOf({ wins: 0, losses: 0 })).toBeNull();
  });

  it("excludes ties from the denominator", () => {
    expect(accuracyOf({ wins: 2, losses: 2 })).toBeCloseTo(0.5);
  });
});

describe("completedPicksOf", () => {
  it("counts graded non-void outcomes; misses are not completed", () => {
    expect(completedPicksOf({ wins: 2, losses: 1, ties: 1 })).toBe(4);
    expect(completedPicksOf({ wins: 0, losses: 0, ties: 0 })).toBe(0);
  });
});

describe("rankStandings", () => {
  it("orders by wins, then accuracy, then completed picks", () => {
    const ranked = rankStandings([
      row("C", 5, 5, 0, 2), // 5 wins, acc .5
      row("A", 8, 2), // leader
      row("B", 5, 3), // 5 wins, acc .625 — beats C on accuracy
      row("D", 5, 5, 4, 0), // 5 wins, acc .5, 14 completed — beats C on completed
    ]);
    expect(ranked.map((r) => r.row.display_name)).toEqual([
      "A",
      "B",
      "D",
      "C",
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it("shares rank on identical rank inputs — standard competition ranking 1,2,2,4", () => {
    const ranked = rankStandings([
      row("Leader", 8, 2),
      row("Tied One", 5, 5),
      row("Tied Two", 5, 5),
      row("Last", 1, 9),
    ]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    // Deterministic order within the shared rank.
    expect(ranked[1].row.display_name).toBe("Tied One");
    expect(ranked[2].row.display_name).toBe("Tied Two");
  });

  it("computes games_behind from the leader's win total, never fractional", () => {
    const ranked = rankStandings([row("A", 8, 2), row("B", 5, 5)]);
    expect(ranked[0].games_behind).toBe(0);
    expect(ranked[1].games_behind).toBe(3);
    for (const r of ranked) expect(Number.isInteger(r.games_behind)).toBe(true);
  });

  it("handles an empty board", () => {
    expect(rankStandings([])).toEqual([]);
  });

  it("keeps null accuracy below any real accuracy at equal wins", () => {
    const ranked = rankStandings([
      row("NoGames", 0, 0, 3), // 0 wins, null accuracy, 3 completed
      row("SomeLosses", 0, 4), // 0 wins, acc 0, 4 completed
    ]);
    expect(ranked[0].row.display_name).toBe("SomeLosses");
    expect(ranked[0].accuracy).toBe(0);
    expect(ranked[1].accuracy).toBeNull();
  });
});
