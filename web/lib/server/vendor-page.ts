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
  const db = await getDb();
  const seal = await mySeal(db, session.user.id);
  if (!seal) redirect("/vendor/start");
  // A vendor screen does not read the Vault. The payee notice and the space list are independent, so they run together.
  const [, where] = await Promise.all([
    notifyPayeesActive(db, { seal: seal.address }).catch((e) => console.error("payee-active notices failed", e instanceof Error ? e.message : e)),
    loadSpaces(session, { warmVault: false }),
  ]);
  return { session, seal, where };
}
