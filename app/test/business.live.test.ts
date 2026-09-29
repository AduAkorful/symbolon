import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { arcTestnet, createArcClient, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, members, users } from "@symbolon/db";
import { AuthError } from "@/lib/server/errors";
import { confirmVault } from "@/lib/server/business";
import { readVaultState, stewardStanding } from "@/lib/server/vault-read";

// A Vault made through this app's setup on Arc testnet (2026-09-29, dev test wallet, dev Steward wallet, paused right after):
// the creation transaction, the wallet that made it and the Steward it names. Recorded from the app's own links and the factory's
// VaultCreated log; the checks below read everything else from the chain.
const CREATION_TX = "0x80fedd6d3d67c3eda6b18ffeefed646bd0fd44ca90881957e85f8f4ff87d1d56";
const OWNER = "0x6361e8a502060898043ac533a4c53535a471210a";
const STEWARD = "0x5efb9b26795077c2dbe5bf03a13e1e4f032bed78";
const VAULT = "0x6e79d7e5d9278b7326589149da29ee49c50ef57d";

describe.skipIf(!process.env.LIVE)("confirming a real Vault on Arc testnet", () => {
  const client = createArcClient(arcTestnet.id);
  const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  async function owned(wallet: string, steward = STEWARD) {
    const [u] = (await db.select().from(users).where(eq(users.wallet, wallet)).limit(1)).concat(await db.insert(users).values({ wallet }).onConflictDoNothing().returning());
    const [b] = await db.insert(businesses).values({ name: "Live", chainId: cfg.chainId, stewardWallet: steward }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
    return { u: u!, b: b! };
  }

  it("takes the Vault address from the chain's log for the wallet that made it", async () => {
    const { u, b } = await owned(OWNER);
    const r = await confirmVault(db, client, cfg, u, b.id, CREATION_TX);
    expect(r.vault).toBe(VAULT);
  }, 60_000);

  it("reads the Steward and its paused state from the chain, and matches the business's Steward", async () => {
    const state = await readVaultState(client, cfg.deployment, VAULT);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    expect(state.owner.toLowerCase()).toBe(OWNER);
    expect(state.steward.toLowerCase()).toBe(STEWARD);
    // paused or active depending on when this runs (the owner can resume it); either way it is the recorded Steward's Vault
    expect(["paused", "active"]).toContain(stewardStanding(STEWARD, state).kind);
    expect(stewardStanding(`0x${"34".repeat(20)}`, state).kind).toBe("mismatch");
  }, 60_000);

  it("refuses the transaction for a business whose Steward is a different wallet", async () => {
    const { u, b } = await owned(OWNER, `0x${"56".repeat(20)}`);
    const e = await confirmVault(db, client, cfg, u, b.id, CREATION_TX).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect((e as AuthError).status).toBe(409);
  }, 60_000);

  it("refuses the same transaction for anyone else", async () => {
    const { u, b } = await owned(`0x${"12".repeat(20)}`);
    const e = await confirmVault(db, client, cfg, u, b.id, CREATION_TX).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AuthError);
    expect((e as AuthError).status).toBe(403);
  }, 60_000);
});
