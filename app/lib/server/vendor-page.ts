import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { requirePageSession } from "./http";
import { mySeal } from "./vendor";
import { loadSpaces } from "./space";

/** A vendor screen: signed in (else /signin), with a Seal (else /v/start). Returns what every vendor screen needs. */
export async function requireVendorPage(next: string) {
  const session = await requirePageSession(next);
  const seal = await mySeal(await getDb(), session.user.id);
  if (!seal) redirect("/v/start");
  return { session, seal, where: await loadSpaces(session) };
}
