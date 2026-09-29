import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { arcTestnet, createArcClient, getDeployment, symbolonContracts } from "@symbolon/chain";
import { createTestDb, users } from "@symbolon/db";
import { sealDomain, signSealMessage, toInvoice, typedData } from "@symbolon/seal";
import { prepareInvoice, sendInvoice } from "@/lib/server/invoice-send";
import { loadPublicInvoice } from "@/lib/server/public-invoice";
import { registerMySeal } from "@/lib/server/vendor";
import { runCheck } from "@/lib/verify-check";

// Against Arc testnet (LIVE=1): an invoice sealed through this app's own functions is read back by the real ledger.
describe.skipIf(!process.env.LIVE)("a sealed invoice against the real ledger on Arc testnet", () => {
  const client = createArcClient(arcTestnet.id);
  const deployment = getDeployment(arcTestnet.id);
  const cfg = { chainId: arcTestnet.id, deployment };
  let db: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    db = await createTestDb();
  });

  it("gets the same fingerprint from the ledger contract, verifies, and reads as genuine and unpaid", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const [u] = await db.insert(users).values({ wallet: account.address.toLowerCase() }).returning();
    await registerMySeal(db, u!, { handle: "live-vendor-x", displayName: "Live Vendor" });

    const p = await prepareInvoice(db, client, cfg, u!, {
      client: { name: "Acme", vault: "0x2222222222222222222222222222222222222222" },
      currency: "USDC",
      invoiceNumber: "9001",
      dueDays: 30,
      lines: [{ description: "Live check", quantity: "3", unitPrice: "333.335" }],
      taxPercent: "7.5",
      earlyPay: [{ percent: "1.5", days: 3 }],
    });
    // The token decimals came from the chain, not from this test
    expect(p.document.currency.decimals).toBe(6);

    // The ledger contract computes the fingerprint of the invoice we derived; ours must be byte-identical
    const invoice = toInvoice(p.document);
    const onchain = await symbolonContracts(client, deployment).ledger.read.fingerprint([invoice]);
    expect(onchain).toBe(p.fingerprint);

    const signature = await signSealMessage(account, typedData(sealDomain(cfg.chainId, deployment.contracts.invoiceLedger), "Invoice", invoice));
    const sent = await sendInvoice(db, client, cfg, u!, { document: p.document, signature });
    expect(sent.fingerprint).toBe(p.fingerprint);

    const view = await loadPublicInvoice(db, client, cfg, p.fingerprint);
    expect(view?.state).toBe("genuine");
    if (view?.state !== "genuine") return;
    expect(view.ledger).toMatchObject({ ok: true, status: { seen: false, paid: false, credited: 0n } });

    const genuine = await runCheck(client, deployment, view.envelope);
    expect(genuine.kind).toBe("genuine");
    const changed = await runCheck(client, deployment, view.envelope.replace("Live check", "Live checkk"));
    expect(changed.kind).toBe("modified");
  }, 120_000);
});
