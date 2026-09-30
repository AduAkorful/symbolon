import { notFound } from "next/navigation";
import { getAddress } from "viem";

import { SettingsView } from "@/components/settings/SettingsView";
import { Shell } from "@/components/shell/Shell";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { loadSpaces } from "@/lib/server/space";
import { loadSettings } from "@/lib/server/settings";
import { loadReleaseInfo, checkReleaseNudge } from "@/lib/server/release";

export const dynamic = "force-dynamic";

export default async function BusinessSettingsPage() {
  const session = await requirePageSession("/business/settings");
  const where = await loadSpaces(session);
  if (!where.business) notFound();

  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  const settingsData = await loadSettings(
    db,
    client,
    config.deployment,
    session.user,
    where.business.id,
  );

  let release = null;
  let nudge = { hasNudge: false };

  if (settingsData.business.vault) {
    const vault = getAddress(settingsData.business.vault);
    const [relInfo, nudgeInfo] = await Promise.all([
      loadReleaseInfo(client, config.deployment, vault).catch(() => null),
      checkReleaseNudge(client, config.deployment, vault).catch(() => ({ hasNudge: false })),
    ]);
    release = relInfo;
    nudge = nudgeInfo;
  }

  const signer = await signerPlanFor(session, config);

  return (
    <Shell where={where} current={{ kind: "business", id: where.business.id }}>
      <SettingsView
        initialData={{
          ...settingsData,
          release,
          nudge,
        }}
        signer={signer}
        isOwner={where.business.role === "owner"}
        userRole={where.business.role}
        explorer={config.deployment.explorer}
      />
    </Shell>
  );
}
