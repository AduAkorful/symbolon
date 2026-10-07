import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { symbolonVaultAbi } from "@symbolon/chain";
import { decodeFunctionData, encodeAbiParameters, encodeFunctionData, encodeEventTopics, erc20Abi, getAddress, decodeFunctionData as decode, type Hex, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, getDeployment, vaultFactoryAbi } from "@symbolon/chain";
import { policyTemplate } from "@symbolon/core";
import { businesses, createTestDb, members, users } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { AuthError } from "@/lib/server/errors";
import { MAX_BUSINESSES, confirmVault, createBusiness, parseUsdcAmount, prepareFund, prepareVault, prepareVaultSwitch, vaultStanding } from "@/lib/server/business";
import { pauseStateOf, readVaultState, stewardStanding } from "@/lib/server/vault-read";
import { TEMPLATES, describePolicy, duration, usd } from "@/lib/server/policy-text";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const factory = cfg.deployment.contracts.vaultFactory;
const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const HASH = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as Hex;

async function person(wallet: string | null = fresh()) {
  const [u] = await db.insert(users).values({ wallet: wallet ? wallet.toLowerCase() : null }).returning();
  return u!;
}

/** A business the person belongs to. Its Steward wallet is already set (as prepareVault leaves it) unless `steward` is null. */
async function ownedBusiness(user: { id: string }, role: "owner" | "approver" | "requester" | "viewer" = "owner", steward: string | null = fresh()) {
  const [b] = await db.insert(businesses).values({ name: "Acme", chainId: cfg.chainId, stewardWallet: steward ? steward.toLowerCase() : null }).returning();
  await db.insert(members).values({ businessId: b!.id, userId: user.id, role });
  return b!;
}

const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  return e as AuthError;
};

/** A receipt as the chain would return it for a `createVault` call */
function receipt(o: { status?: "success" | "reverted"; to?: string; logAddress?: string; owner: string; steward: string; vault?: string; logs?: number }) {
  const vault = o.vault ?? fresh();
  const log = {
    address: o.logAddress ?? factory,
    topics: encodeEventTopics({ abi: vaultFactoryAbi, eventName: "VaultCreated", args: { vault: getAddress(vault), owner: getAddress(o.owner), steward: getAddress(o.steward) } }),
    data: encodeAbiParameters([{ type: "address" }], [fresh()]),
  };
  return { vault, r: { status: o.status ?? "success", to: o.to ?? factory, blockNumber: 1000n, logs: Array.from({ length: o.logs ?? 1 }, () => log) } };
}

/** A chain that knows one transaction, and says which vaults the factory made and who owns them */
function chain(rc: { r: object; vault: string }, opts: { isVault?: boolean; owner?: string } = {}): PublicClient {
  return {
    getTransactionReceipt: async () => rc.r,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "isVault") return opts.isVault ?? true;
      if (functionName === "getVaultState") return { owner: opts.owner ?? "0x0000000000000000000000000000000000000000" };
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
}

describe("createBusiness", () => {
  it("makes the person its owner and trims and normalises the name", async () => {
    const u = await person();
    const { id } = await createBusiness(db, u, "  Acme Operations ", cfg.chainId);
    const [m] = await db.select().from(members).where(eq(members.businessId, id));
    expect(m).toMatchObject({ userId: u.id, role: "owner" });
    expect((await db.select().from(businesses).where(eq(businesses.id, id)))[0]!.name).toBe("Acme Operations");
  });

  it.each(["", "A", " x ", "a".repeat(81), "bad\u0007name"])("refuses the name %j", async (n) => {
    expect((await err(createBusiness(db, await person(), n, cfg.chainId))).status).toBe(400);
  });

  it("stops at the cap per chain", async () => {
    const u = await person();
    for (let i = 0; i < MAX_BUSINESSES; i++) await createBusiness(db, u, `Biz ${i}`, cfg.chainId);
    expect((await err(createBusiness(db, u, "One more", cfg.chainId))).status).toBe(409);
    await createBusiness(db, u, "Other chain", 1); // the limit counts this chain only
  });
});

/** A stand-in Steward provisioner: one address per business, counting how often it is really asked */
function provisioner() {
  const made = new Map<string, string>();
  const calls: string[] = [];
  const fn = async (businessId: string) => {
    calls.push(businessId);
    if (!made.has(businessId)) made.set(businessId, fresh());
    return made.get(businessId)!;
  };
  return { fn, calls, made };
}

describe("prepareVault", () => {
  it("encodes createVault for the person's own wallet, the chosen template and the business's own Steward wallet", async () => {
    const u = await person();
    const b = await ownedBusiness(u, "owner", null);
    const p = provisioner();
    const r = await prepareVault(db, cfg, u, b.id, "strict", p.fn);
    expect(r.to).toBe(factory);
    const { functionName, args } = decodeFunctionData({ abi: vaultFactoryAbi, data: r.data });
    expect(functionName).toBe("createVault");
    const [owner, steward, policy, tokens, decimals, autoUpdate] = args as unknown as [string, string, Record<string, bigint | number>, string[], number, boolean];
    expect(owner).toBe(getAddress(u.wallet!));
    expect(steward).toBe(getAddress(p.made.get(b.id)!));
    expect(r.steward).toBe(steward);
    expect(policy).toMatchObject(policyTemplate("strict") as unknown as Record<string, unknown>);
    expect(tokens).toEqual([cfg.deployment.tokens.usdc]);
    expect(decimals).toBe(6);
    expect(autoUpdate).toBe(false);
    expect(r.summary.name).toBe("Strict");
    // saved on the business, lowercase, so confirmVault can compare against it
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.stewardWallet).toBe(steward.toLowerCase());
  });

  it("provisions once when asked twice, and reuses a wallet the business already has", async () => {
    const u = await person();
    const b = await ownedBusiness(u, "owner", null);
    const p = provisioner();
    const first = await prepareVault(db, cfg, u, b.id, "standard", p.fn);
    const second = await prepareVault(db, cfg, u, b.id, "starter", p.fn);
    expect(second.steward).toBe(first.steward);
    expect(p.calls).toEqual([b.id]);

    const had = fresh();
    const b2 = await ownedBusiness(u, "owner", had);
    const p2 = provisioner();
    expect((await prepareVault(db, cfg, u, b2.id, "standard", p2.fn)).steward).toBe(getAddress(had));
    expect(p2.calls).toEqual([]);
  });

  it("creates nothing when no Steward wallet can be made: 503 without a provider, 502 when it fails", async () => {
    const u = await person();
    const none = await ownedBusiness(u, "owner", null);
    expect((await err(prepareVault(db, cfg, u, none.id, "standard", null))).status).toBe(503);
    const down = await ownedBusiness(u, "owner", null);
    const boom = async () => {
      throw new Error("circle is down");
    };
    expect((await err(prepareVault(db, cfg, u, down.id, "standard", boom))).status).toBe(502);
    for (const b of [none, down]) expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.stewardWallet).toBeNull();
  });

  it("refuses a Steward that is the owner's own wallet", async () => {
    const u = await person();
    const b = await ownedBusiness(u, "owner", null);
    expect((await err(prepareVault(db, cfg, u, b.id, "standard", async () => u.wallet!))).status).toBe(409);
  });

  it("refuses non-owners, other people's businesses, a missing wallet, a bad template and a second Vault", async () => {
    const u = await person();
    const p = provisioner();
    for (const role of ["approver", "requester", "viewer"] as const) {
      const b = await ownedBusiness(u, role);
      expect((await err(prepareVault(db, cfg, u, b.id, "standard", p.fn))).status).toBe(403);
    }
    const stranger = await person();
    const b = await ownedBusiness(u);
    expect((await err(prepareVault(db, cfg, stranger, b.id, "standard", p.fn))).status).toBe(403);
    expect((await err(prepareVault(db, cfg, u, "not-an-id", "standard", p.fn))).status).toBe(403);
    const noWallet = await person(null);
    const nb = await ownedBusiness(noWallet);
    expect((await err(prepareVault(db, cfg, noWallet, nb.id, "standard", p.fn))).status).toBe(409);
    expect((await err(prepareVault(db, cfg, u, b.id, "yolo", p.fn))).status).toBe(400);
    await db.update(businesses).set({ vault: fresh().toLowerCase() }).where(eq(businesses.id, b.id));
    expect((await err(prepareVault(db, cfg, u, b.id, "standard", p.fn))).status).toBe(409);
    expect(p.calls).toEqual([]); // none of the refusals made a wallet
  });
});

describe("confirmVault (the chain decides)", () => {
  it("saves the Vault from the log when the person's wallet made it through the current factory", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const rc = receipt({ owner: u.wallet!, steward: b.stewardWallet! });
    const r = await confirmVault(db, chain(rc, { owner: u.wallet! }), cfg, u, b.id, HASH(1));
    expect(r.vault).toBe(rc.vault.toLowerCase());
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.vault).toBe(rc.vault.toLowerCase());
  });

  it("is harmless to repeat, and refuses a different Vault for the same business", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const rc = receipt({ owner: u.wallet!, steward: b.stewardWallet! });
    const client = chain(rc, { owner: u.wallet! });
    await confirmVault(db, client, cfg, u, b.id, HASH(2));
    expect((await confirmVault(db, client, cfg, u, b.id, HASH(2))).vault).toBe(rc.vault.toLowerCase());
    const other = receipt({ owner: u.wallet!, steward: b.stewardWallet! });
    expect((await err(confirmVault(db, chain(other, { owner: u.wallet! }), cfg, u, b.id, HASH(3)))).status).toBe(409);
  });

  it("refuses everything that isn't exactly the person's own Vault from the current factory", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const mine = u.wallet!;
    const st = b.stewardWallet!;
    const cases: [string, ReturnType<typeof receipt>, { isVault?: boolean; owner?: string }, number][] = [
      ["a reverted transaction", receipt({ owner: mine, steward: st, status: "reverted" }), { owner: mine }, 409],
      ["a transaction to another contract", receipt({ owner: mine, steward: st, to: fresh() }), { owner: mine }, 409],
      ["a look-alike event from another contract", receipt({ owner: mine, steward: st, logAddress: fresh() }), { owner: mine }, 409],
      ["two Vaults in one transaction", receipt({ owner: mine, steward: st, logs: 2 }), { owner: mine }, 409],
      ["a Vault owned by someone else (someone else's transaction)", receipt({ owner: fresh(), steward: st }), {}, 403],
      ["a Vault the factory doesn't know", receipt({ owner: mine, steward: st }), { isVault: false, owner: mine }, 409],
      ["a Vault whose owner onchain isn't the wallet", receipt({ owner: mine, steward: st }), { owner: fresh() }, 409],
      ["a Vault made with a different Steward", receipt({ owner: mine, steward: fresh() }), { owner: mine }, 409],
      ["a Vault made with no Steward", receipt({ owner: mine, steward: "0x0000000000000000000000000000000000000000" }), { owner: mine }, 409],
    ];
    for (const [name, rc, opts, status] of cases) {
      const e = await err(confirmVault(db, chain(rc, opts), cfg, u, b.id, HASH(9)));
      expect(e.status, name).toBe(status);
    }
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.vault).toBeNull();
  });

  it("refuses a Vault for a business whose Steward the server never prepared", async () => {
    const u = await person();
    const b = await ownedBusiness(u, "owner", null);
    const rc = receipt({ owner: u.wallet!, steward: fresh() });
    expect((await err(confirmVault(db, chain(rc, { owner: u.wallet! }), cfg, u, b.id, HASH(6)))).status).toBe(409);
    expect((await db.select().from(businesses).where(eq(businesses.id, b.id)))[0]!.vault).toBeNull();
  });

  it("says a pending or unknown transaction isn't confirmed, and rejects a malformed hash", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const missing = { getTransactionReceipt: async () => { throw new Error("not found"); } } as unknown as PublicClient;
    expect((await err(confirmVault(db, missing, cfg, u, b.id, HASH(4)))).message).toMatch(/isn't confirmed yet/);
    expect((await err(confirmVault(db, missing, cfg, u, b.id, "0x12"))).status).toBe(400);
    expect((await err(confirmVault(db, missing, cfg, u, b.id, undefined))).status).toBe(400);
  });

  it("lets only one business hold a Vault, and only its owner record it", async () => {
    const u = await person();
    const b1 = await ownedBusiness(u);
    const b2 = await ownedBusiness(u);
    const rc = receipt({ owner: u.wallet!, steward: b1.stewardWallet! });
    const client = chain(rc, { owner: u.wallet! });
    await confirmVault(db, client, cfg, u, b1.id, HASH(5));
    await db.update(businesses).set({ stewardWallet: b1.stewardWallet }).where(eq(businesses.id, b2.id)); // same Steward, so only the Vault repeats
    expect((await err(confirmVault(db, client, cfg, u, b2.id, HASH(5)))).status).toBe(409);
    const viewer = await person();
    const vb = await ownedBusiness(viewer, "viewer");
    expect((await err(confirmVault(db, client, cfg, viewer, vb.id, HASH(5)))).status).toBe(403);
  });
});

/** A lens that reports one Vault's state; the read client for the pause tests */
function stateClient(state: { paused: boolean; steward: string; owner?: string } | "down"): PublicClient {
  return {
    getBlockNumber: async () => 123n,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (state === "down") throw new Error("rpc down");
      if (functionName === "getVaultState") return { owner: state.owner ?? fresh(), steward: state.steward, paused: state.paused };
      throw new Error(`unexpected read ${functionName}`);
    },
  } as unknown as PublicClient;
}

describe("pause and resume (the owner's call, to the recorded Vault)", () => {
  it("encodes pause() and unpause() to the business's own Vault", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const vault = fresh();
    await db.update(businesses).set({ vault: vault.toLowerCase() }).where(eq(businesses.id, b.id));
    const p = await prepareVaultSwitch(db, cfg, u, b.id, "pause");
    expect(p.to).toBe(getAddress(vault));
    expect(decode({ abi: symbolonVaultAbi, data: p.data }).functionName).toBe("pause");
    const r = await prepareVaultSwitch(db, cfg, u, b.id, "resume");
    expect(r.to).toBe(getAddress(vault));
    expect(decode({ abi: symbolonVaultAbi, data: r.data }).functionName).toBe("unpause");
  });

  it("is for the owner only, and needs a Vault", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    expect((await err(prepareVaultSwitch(db, cfg, u, b.id, "pause"))).status).toBe(409);
    for (const role of ["approver", "requester", "viewer"] as const) {
      const other = await ownedBusiness(u, role);
      await db.update(businesses).set({ vault: fresh().toLowerCase() }).where(eq(businesses.id, other.id));
      expect((await err(prepareVaultSwitch(db, cfg, u, other.id, "pause"))).status).toBe(403);
      expect((await err(prepareVaultSwitch(db, cfg, u, other.id, "resume"))).status).toBe(403);
    }
    const stranger = await person();
    expect((await err(prepareVaultSwitch(db, cfg, stranger, b.id, "pause"))).status).toBe(403);
  });
});

describe("the Steward's standing is what the chain says, checked against the wallet we set up", () => {
  const S = fresh();
  it("is paused or active only when the Vault's Steward is the recorded wallet", async () => {
    const paused = await readVaultState(stateClient({ paused: true, steward: S }), cfg.deployment, fresh());
    expect(stewardStanding(S.toLowerCase(), paused)).toMatchObject({ kind: "paused", steward: getAddress(S), block: 123n });
    const active = await readVaultState(stateClient({ paused: false, steward: S }), cfg.deployment, fresh());
    expect(stewardStanding(S, active).kind).toBe("active");
  });

  it("calls a different or empty onchain Steward a mismatch, never paused or active", async () => {
    const other = await readVaultState(stateClient({ paused: true, steward: fresh() }), cfg.deployment, fresh());
    expect(stewardStanding(S, other).kind).toBe("mismatch");
    const empty = await readVaultState(stateClient({ paused: true, steward: "0x0000000000000000000000000000000000000000" }), cfg.deployment, fresh());
    expect(stewardStanding(S, empty).kind).toBe("mismatch");
  });

  it("says a failed read is unknown, and an older Vault (no recorded Steward) has none", async () => {
    const down = await readVaultState(stateClient("down"), cfg.deployment, fresh());
    expect(down.ok).toBe(false);
    expect(stewardStanding(S, down).kind).toBe("unknown");
    expect(stewardStanding(null, down).kind).toBe("none");
  });

  it("keeps the owner's pause control available whatever the Steward's standing (A1)", async () => {
    // a Steward that isn't the recorded wallet: the Vault is still the owner's to pause
    const mismatch = await readVaultState(stateClient({ paused: false, steward: fresh() }), cfg.deployment, fresh());
    expect(stewardStanding(S, mismatch).kind).toBe("mismatch");
    expect(pauseStateOf(mismatch)).toEqual({ known: true, paused: false, block: 123n });
    const pausedMismatch = await readVaultState(stateClient({ paused: true, steward: fresh() }), cfg.deployment, fresh());
    expect(pauseStateOf(pausedMismatch)).toEqual({ known: true, paused: true, block: 123n });
    // an unreadable Vault: no guess about paused, and the control is still offered as "pause"
    const down = await readVaultState(stateClient("down"), cfg.deployment, fresh());
    expect(pauseStateOf(down)).toEqual({ known: false });
  });

  it("is ready for the wizard only when paused; owner only; needs a Vault", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const vault = fresh();
    expect((await err(vaultStanding(db, stateClient({ paused: true, steward: b.stewardWallet! }), cfg, u, b.id))).status).toBe(409);
    await db.update(businesses).set({ vault: vault.toLowerCase() }).where(eq(businesses.id, b.id));
    expect(await vaultStanding(db, stateClient({ paused: true, steward: b.stewardWallet! }), cfg, u, b.id)).toMatchObject({ kind: "paused", ready: true, paused: true, block: "123" });
    expect(await vaultStanding(db, stateClient({ paused: false, steward: b.stewardWallet! }), cfg, u, b.id)).toMatchObject({ kind: "active", ready: false, paused: false });
    expect(await vaultStanding(db, stateClient({ paused: true, steward: fresh() }), cfg, u, b.id)).toMatchObject({ kind: "mismatch", ready: false, paused: true, block: "123" });
    expect(await vaultStanding(db, stateClient({ paused: false, steward: fresh() }), cfg, u, b.id)).toMatchObject({ kind: "mismatch", ready: false, paused: false, block: "123" });
    expect(await vaultStanding(db, stateClient("down"), cfg, u, b.id)).toMatchObject({ kind: "unknown", ready: false, paused: null, block: null });
    const viewer = await ownedBusiness(u, "viewer");
    await db.update(businesses).set({ vault: fresh().toLowerCase() }).where(eq(businesses.id, viewer.id));
    expect((await err(vaultStanding(db, stateClient({ paused: true, steward: fresh() }), cfg, u, viewer.id))).status).toBe(403);
  });
});

describe("funding", () => {
  it.each([["250", 250_000_000n], ["250.5", 250_500_000n], ["0.000001", 1n], [" 1 ", 1_000_000n]])("reads %j as exact 6-decimal units", (t, v) => expect(parseUsdcAmount(t)).toBe(v));
  it.each(["", "0", "0.0", "-5", "1e6", "1.1234567", "abc", "1,000", "9999999999999", ".5", undefined, 5])("refuses the amount %j", (t) => expect(() => parseUsdcAmount(t)).toThrow(AuthError));

  it("encodes a USDC transfer into the business's Vault, from the registry's token", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    const vault = fresh();
    await db.update(businesses).set({ vault: vault.toLowerCase() }).where(eq(businesses.id, b.id));
    const r = await prepareFund(db, cfg, u, b.id, "12.5");
    expect(r.to).toBe(cfg.deployment.tokens.usdc);
    const d = decode({ abi: erc20Abi, data: r.data });
    expect(d.functionName).toBe("transfer");
    expect(d.args).toEqual([getAddress(vault), 12_500_000n]);
  });

  it("needs a Vault and an owner", async () => {
    const u = await person();
    const b = await ownedBusiness(u);
    expect((await err(prepareFund(db, cfg, u, b.id, "5"))).status).toBe(409);
    const v = await ownedBusiness(u, "viewer");
    expect((await err(prepareFund(db, cfg, u, v.id, "5"))).status).toBe(403);
  });
});

describe("policy text comes from the code that builds the policy", () => {
  it.each(TEMPLATES)("%s says what policyTemplate sets", (t) => {
    const p = policyTemplate(t);
    const text = describePolicy(t).lines.join("\n");
    expect(text).toContain(`Auto-pay up to ${usd(p.autoPayLimit)}`);
    expect(text).toContain(`Owner signs above ${usd(p.ownerThreshold)}`);
    expect(text).toContain(`No single payment above ${usd(p.perTxCap)}`);
    expect(text).toContain(`Loosening changes wait ${duration(p.looseningDelay)}`);
    expect(text).toContain(`${p.newVendorMinPaid} or more paid`);
  });

  it("formats money and time exactly", () => {
    expect(usd(1_000_000_000n)).toBe("$1,000.00");
    expect(usd(12_340_000n)).toBe("$12.34");
    expect(duration(12n * 3600n)).toBe("12 hours");
    expect(duration(48n * 3600n)).toBe("2 days");
    expect(duration(86_400n)).toBe("1 day");
  });
});
