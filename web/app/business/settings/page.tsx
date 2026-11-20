import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getAddress } from "viem";

import { SettingsView } from "@/components/settings/SettingsView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession, type CurrentSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { loadSettings } from "@/lib/server/settings";
import { loadReleaseInfoWithTx, checkReleaseNudge } from "@/lib/server/release";
import { PageLoading } from "@/components/ui/PageLoading";

export const dynamic = "force-dynamic";

export default async function BusinessSettingsPage() {
  const session = await requirePageSession("/business/settings");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <Suspense fallback={<PageLoading title="Settings" shape="summary" />}>
        <SettingsContent session={session} businessId={where.business.id} role={where.business.role} />
      </Suspense>
    </Shell>
  );
}

async function SettingsContent({ session, businessId, role }: { session: CurrentSession; businessId: string; role: NonNullable<Awaited<ReturnType<typeof loadSpaces>>["business"]>["role"] }) {
  const config = getConfig();
  const db = await getDb();
  const client = getClient();
  const settingsData = await loadSettings(db, client, config.deployment, session.user, businessId);

  let release = null;
  let nudge = { hasNudge: false };

  if (settingsData.business.vault) {
    const vault = getAddress(settingsData.business.vault);
    const [relInfo, nudgeInfo] = await Promise.all([
      loadReleaseInfoWithTx(db, client, config.deployment, vault).catch(() => null),
      checkReleaseNudge(client, config.deployment, vault).catch(() => ({ hasNudge: false })),
    ]);
    release = relInfo;
    nudge = nudgeInfo;
  }

  const signer = signerPlanFor(session, config);

  return (
    <SettingsView
      initialData={{ ...settingsData, release, nudge }}
      signer={signer}
      isOwner={role === "owner"}
      userRole={role}
      explorer={config.deployment.explorer}
    />
  );
}
