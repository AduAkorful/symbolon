import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { PublicClient } from "viem";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { DOCUMENT_SCHEMA, completeTotals, encodeSealedInvoice, sealInvoice, type InvoiceDocument } from "@symbolon/seal";
import { readEnvelope, runCheck } from "@/lib/verify-check";

const dep = getDeployment(arcTestnet.id);
const LEDGER = dep.contracts.invoiceLedger;
const account = privateKeyToAccount(generatePrivateKey());

function document(over: Partial<InvoiceDocument> = {}): InvoiceDocument {
  return {
    ...completeTotals({
      schema: DOCUMENT_SCHEMA,
      seal: account.address.toLowerCase(),
      vendor: { name: "Studio Ana" },
      payer: { name: "Acme", vault: "0x2222222222222222222222222222222222222222" },
      invoiceNumber: "0144",
      issuedAt: 1_790_000_000,
      dueDate: 1_792_592_000,
      currency: { chainId: arcTestnet.id, token: dep.tokens.usdc.toLowerCase(), symbol: "USDC", decimals: 6 },
      lineItems: [{ description: "Work", quantity: "1", unitPrice: "100" }],
      taxes: [],
      discounts: [],
      payout: { address: account.address.toLowerCase(), domain: dep.cctpDomain },
      earlyPay: [],
      attachments: [],
    } as never),
    ...over,
  };
}

async function sealed(doc = document(), ledger = LEDGER, chainId = arcTestnet.id) {
  const s = await sealInvoice({ signer: account, chainId, ledger, document: { ...doc, currency: { ...doc.currency, chainId } } });
  return { text: encodeSealedInvoice(s.sealed), fingerprint: s.fingerprint };
}

/** A chain whose ledger reports the given status for any fingerprint and has no settlement logs */
function chain(o: { seen?: boolean; credited?: bigint; total?: bigint; down?: boolean } = {}): PublicClient {
  const total = o.total ?? 100_000_000n;
  return {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (o.down) throw new Error("rpc down");
      if (functionName === "status") return { seen: o.seen ?? false, seal: account.address, total, credited: o.credited ?? 0n, cancelled: false };
      if (functionName === "remaining") return total - (o.credited ?? 0n);
      throw new Error(`unexpected ${functionName}`);
    },
    getCode: async () => undefined,
    call: async () => ({ data: undefined }),
    getLogs: async () => [],
    getBlockNumber: async () => 100n,
    getBlock: async () => ({ timestamp: 1_790_000_100n }),
  } as unknown as PublicClient;
}

describe("reading a file", () => {
  it.each([["", /empty/], ["not json", /isn't a Symbolon invoice file/], ["{}", /not a sealed Symbolon invoice/], ["[]", /not a sealed/], ["x".repeat(2_000_001), /too large/]])(
    "refuses %j",
    (text, why) => {
      const r = readEnvelope(text);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(why);
    },
  );
});

describe("the verify page's answer", () => {
  it("calls a properly sealed invoice genuine and unpaid when the ledger hasn't seen it", async () => {
    const { text, fingerprint } = await sealed();
    const r = await runCheck(chain(), dep, text);
    expect(r.kind).toBe("genuine");
    if (r.kind !== "genuine") return;
    expect(r.check.verification.fingerprint).toBe(fingerprint);
    expect(r.check.status?.seen).toBe(false);
    expect(r.ledger).toEqual({ ok: true });
  });

  it("calls a document with one character changed modified", async () => {
    const { text } = await sealed();
    const changed = text.replace('"Studio Ana"', '"Studio Anb"');
    expect(changed).not.toBe(text);
    const r = await runCheck(chain(), dep, changed);
    expect(r.kind).toBe("modified");
    if (r.kind === "modified") expect(r.issues.some((i) => i.code === "signature")).toBe(true);
  });

  it("calls a changed payout address modified", async () => {
    const { text } = await sealed();
    const changed = text.replace(account.address.toLowerCase(), "0x9999999999999999999999999999999999999999");
    expect((await runCheck(chain(), dep, changed)).kind).toBe("modified");
  });

  it("says an invoice sealed for another ledger can't be paid here", async () => {
    const { text } = await sealed(document(), "0x4444444444444444444444444444444444444444");
    expect((await runCheck(chain(), dep, text)).kind).toBe("elsewhere");
  });

  it("says a file that isn't an invoice is unsealed", async () => {
    expect((await runCheck(chain(), dep, "hello")).kind).toBe("unsealed");
    expect((await runCheck(chain(), dep, JSON.stringify({ v: 1 }))).kind).toBe("unsealed");
  });

  it("still checks the signature when the ledger can't be read, and says it couldn't read it", async () => {
    const { text } = await sealed();
    const r = await runCheck(chain({ down: true }), dep, text);
    expect(r.kind).toBe("genuine");
    if (r.kind === "genuine") expect(r.ledger).toEqual({ ok: false, reason: "Can't read the ledger on Arc right now." });
  });

  it("reads what the ledger says about payment", async () => {
    const { text } = await sealed();
    const r = await runCheck(chain({ seen: true, credited: 100_000_000n }), dep, text);
    expect(r.kind === "genuine" && r.check.status).toMatchObject({ seen: true, paid: true, credited: 100_000_000n });
  });

  it("uses no network but the RPC client it was given", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const { text } = await sealed();
      await runCheck(chain(), dep, text);
      await runCheck(chain(), dep, "junk");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
