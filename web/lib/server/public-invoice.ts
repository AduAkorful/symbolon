import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import { invoiceStatus, symbolonContracts, type InvoiceStatus } from "@symbolon/chain";
import { invoices, seals, type Database } from "@symbolon/db";
import { encodeSealedInvoice, decodeSealedInvoice, verifySealedInvoice, type InvoiceDocument, type Issue } from "@symbolon/seal";
import type { ChainSettings } from "./business";

// Plan 05i, V10. The public invoice link. It shows only what the sealed document contains, checks it again on every request, and reads
// the ledger live. It never reports a state it hasn't just checked.

export type PublicInvoice =
  | {
      state: "genuine";
      fingerprint: string;
      document: InvoiceDocument;
      /** The exact bytes of the sealed file, for the download */
      envelope: string;
      seal: { address: string; handle: string | null; verifiedDomain: string | null };
      ledger: { ok: true; status: InvoiceStatus } | { ok: false; reason: string };
    }
  | { state: "failed"; fingerprint: string; issues: Issue[] };

export async function loadPublicInvoice(db: Database, client: PublicClient, cfg: ChainSettings, fingerprint: string): Promise<PublicInvoice | null> {
  if (!/^0x[0-9a-f]{64}$/.test(fingerprint)) return null;
  const [row] = await db.select().from(invoices).where(eq(invoices.fingerprint, fingerprint)).limit(1);
  // A rejected invoice is never served, not even to say what was wrong with it
  if (!row || row.status === "rejected") return null;

  const expected = { chainId: cfg.chainId, ledger: cfg.deployment.contracts.invoiceLedger };
  const v = await verifySealedInvoice(row.envelope, { client, expected });
  if (!v.ok || !v.document || v.fingerprint?.toLowerCase() !== fingerprint) {
    return { state: "failed", fingerprint, issues: v.issues.length ? v.issues : [{ code: "signature", path: "", message: "the stored invoice doesn't match its fingerprint" }] };
  }

  const [seal] = await db.select({ handle: seals.handle, verifiedDomain: seals.verifiedDomain }).from(seals).where(eq(seals.address, v.document.seal)).limit(1);
  let ledger: Extract<PublicInvoice, { state: "genuine" }>["ledger"];
  try {
    ledger = { ok: true, status: await invoiceStatus(symbolonContracts(client, cfg.deployment), fingerprint as `0x${string}`) };
  } catch {
    ledger = { ok: false, reason: "Can't read the ledger on Arc right now." };
  }
  return {
    state: "genuine",
    fingerprint,
    document: v.document,
    envelope: encodeSealedInvoice(decodeSealedInvoice(row.envelope)),
    seal: { address: v.document.seal, handle: seal?.handle ?? null, verifiedDomain: seal?.verifiedDomain ?? null },
    ledger,
  };
}
