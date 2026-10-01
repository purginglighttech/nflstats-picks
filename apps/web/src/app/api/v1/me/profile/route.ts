import { NextResponse } from "next/server";
import { v1 } from "@pickem/contracts";
import { ApiErrorException, unauthorized, withApi } from "@/lib/api/with-api";
import { profileJson } from "@/lib/api/shapes";
import {
  DisplayNameTakenError,
  findUserById,
  updateDisplayName,
} from "@/lib/auth/users";

/** GET /api/v1/me/profile — read own profile. */
export const GET = withApi("me:profile:get", { auth: "session" }, async (_req, ctx) => {
  const user = await findUserById(ctx.session!.userId);
  if (!user) throw unauthorized();
  return NextResponse.json({ profile: profileJson(user) });
});

/** PATCH /api/v1/me/profile — update display name (email changes out of scope). */
export const PATCH = withApi(
  "me:profile:patch",
  { auth: "session", body: v1.PatchProfileRequestSchema },
  async (_req, ctx) => {
    const userId = ctx.session!.userId;
    if (ctx.body.display_name !== undefined) {
      try {
        await updateDisplayName(userId, ctx.body.display_name);
      } catch (err) {
        if (err instanceof DisplayNameTakenError) {
          throw new ApiErrorException(409, "display_name_taken", err.message);
        }
        throw err;
      }
    }
    const user = await findUserById(userId);
    if (!user) throw unauthorized();
    return NextResponse.json({ profile: profileJson(user) });
  },
);
