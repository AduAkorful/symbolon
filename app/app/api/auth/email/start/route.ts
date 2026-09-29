import { NextResponse } from "next/server";
import { getCircleAuth } from "@/lib/server/circle";
import { getDb } from "@/lib/server/db";
import { startEmailSignIn } from "@/lib/server/email-signin";
import { AuthError } from "@/lib/server/errors";
import { readBody, route } from "@/lib/server/http";

/** Asks Circle to email a code. The email stays on the server, tied to the challenge that comes back. */
export const POST = route(async (request) => {
  const { email, deviceId } = await readBody(request);
  if (typeof email !== "string" || typeof deviceId !== "string") throw new AuthError(400, "Send an email address and a device id.");
  return NextResponse.json(await startEmailSignIn(await getDb(), getCircleAuth(), { email, deviceId }));
});
