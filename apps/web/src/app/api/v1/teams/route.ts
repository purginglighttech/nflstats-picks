import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, withApi } from "@/lib/api/with-api";
import { getLatestSeasonYear, getTeamsWithRecords } from "@/lib/teams";

/**
 * GET /api/v1/teams — all 32 teams with final-game records for the
 * latest season. Public read.
 */
export const GET = withApi(
  "teams:list",
  { auth: "none" },
  async () => {
    const season = await getLatestSeasonYear();
    if (season === null) {
      throw new ApiErrorException(404, "season_not_found", "No NFL season data.");
    }
    const teams = await getTeamsWithRecords(season);
    return NextResponse.json(
      v1.TeamsResponseSchema.parse({
        season,
        teams: teams.map((t) => ({
          abbreviation: t.abbreviation,
          city: t.city,
          name: t.name,
          conference: t.conference,
          division: t.division,
          accent_light: t.accent_light,
          accent_dark: t.accent_dark,
          wins: t.wins,
          losses: t.losses,
          ties: t.ties,
          points_for: t.points_for,
          points_against: t.points_against,
        })),
      })
    );
  }
);
