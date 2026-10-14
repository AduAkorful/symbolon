import { redirect } from "next/navigation";
import { Onboarding } from "@/components/vendor/Onboarding";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { mySeal } from "@/lib/server/vendor";
import { safeNext } from "@/lib/next-path";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { getConfig } from "@/lib/server/config";
import { signerPlanFor } from "@/lib/server/signer-plan";

export const dynamic = "force-dynamic";

/** Vendor sign-up: register a Seal. A person who already has one goes to their home. */
export default async function VendorStart({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const query = await searchParams;
  const next = safeNext(query.next, "/vendor");
  const session = await requirePageSession(`/vendor/start${query.next ? `?next=${encodeURIComponent(next)}` : ""}`);
  if (await mySeal(await getDb(), session.user.id)) redirect(next);
  return (
    <PrivyBoundary>
      <Onboarding wallet={session.user.wallet} signer={signerPlanFor(session, getConfig())} next={next} />
    </PrivyBoundary>
  );
}
