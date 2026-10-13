import "server-only";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import { notifyPayeesActive } from "./payee-active";
import { requirePageSession } from "./http";
import { mySeal } from "./vendor";
import { loadSpaces } from "./space";

/** A vendor screen: signed in (else /signin), with a Seal (else /v/start). Returns what every vendor screen needs. */
export async function requireVendorPage(next: string) {
  const session = await requirePageSession(next);
  const seal = await mySeal(await getDb(), session.user.id);
  if (!seal) redirect("/vendor/start");
  // a payee waiting period that has passed since they last looked is told before the bell is counted (plan 05zj E, D11 a)
  await notifyPayeesActive(await getDb(), { seal: seal.address }).catch((e) => console.error("payee-active notices failed", e instanceof Error ? e.message : e));
  return { session, seal, where: await loadSpaces(session) };
}
