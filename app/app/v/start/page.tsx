import { redirect } from "next/navigation";
import { Onboarding } from "@/components/vendor/Onboarding";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { mySeal } from "@/lib/server/vendor";
import { safeNext } from "@/lib/next-path";

export const dynamic = "force-dynamic";

/** Vendor sign-up: register a Seal. A person who already has one goes to their home. */
export default async function VendorStart({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const next = safeNext(query.next, "/v");
  const session = await requirePageSession(`/v/start${query.next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (await mySeal(await getDb(), session.user.id)) redirect(next);
  return <Onboarding wallet={session.user.wallet} next={next} />;
}
