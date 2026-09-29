import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { arcChain } from "@symbolon/chain";
import { businesses, members } from "@symbolon/db";
import { Wordmark } from "@/components/Marks";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { Setup, type Standing } from "@/components/setup/Setup";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { requirePageSession } from "@/lib/server/http";
import { signerPlanFor } from "@/lib/server/signer-plan";
import { TEMPLATES, describePolicy } from "@/lib/server/policy-text";
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";

export const dynamic = "force-dynamic";

/** Setting up a business (B1–B3). Picks up where the person left off: a business with no Vault continues at Policy, one with a Vault at Fund. */
export default async function SetupPage({ searchParams }: { searchParams: Promise<{ business?: string }> }) {
  const session = await requirePageSession("/setup");
  const config = getConfig();
  const db = await getDb();
  const wanted = (await searchParams).business;

  // The person's own businesses (as owner) on this chain: one with no Vault yet is the one to finish
  const owned = await db
    .select({ id: businesses.id, name: businesses.name, vault: businesses.vault, stewardWallet: businesses.stewardWallet })
    .from(members)
    .innerJoin(businesses, eq(businesses.id, members.businessId))
    .where(and(eq(members.userId, session.user.id), eq(members.role, "owner"), eq(businesses.chainId, config.chainId)))
    .orderBy(businesses.createdAt);
  const open = owned.find((b) => b.id === wanted) ?? owned.find((b) => b.vault === null) ?? null;

  // A Vault we know about: what the chain says about its Steward decides whether the wizard goes on to Fund (plan 05h, H13)
  const standing: Standing | null = open?.vault ? stewardStanding(open.stewardWallet, await readVaultState(getClient(), config.deployment, open.vault)).kind : null;

  
  const signer = signerPlanFor(session, config);

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Link href="/" aria-label="Symbolon home">
          <Wordmark />
        </Link>
        <Link href="/business" className="text-sm text-graphite underline decoration-rule underline-offset-4">
          Back to the app
        </Link>
      </header>
      <PrivyBoundary>
      <Setup
        key={open?.id ?? "new"}
        business={open ? { id: open.id, name: open.name, vault: open.vault } : null}
        standing={standing}
        templates={TEMPLATES.map(describePolicy)}
        signer={signer}
        explorer={arcChain(config.chainId).blockExplorers!.default.url}
      />
      </PrivyBoundary>
    </div>
  );
}
