import "server-only";
import { createCircleAuth, type CircleAuth } from "./circle-auth";
import { getConfig } from "./config";
import { AuthError } from "./errors";

let cached: CircleAuth | undefined;

/** Circle's email sign-in, or a 503 that says it isn't set up here (no API key or App ID in the environment) */
export function getCircleAuth(): CircleAuth {
  const { circle } = getConfig();
  if (!circle) throw new AuthError(503, "Email sign-in isn't set up on this server. Use a wallet instead.");
  return (cached ??= createCircleAuth({ apiKey: circle.apiKey }));
}
