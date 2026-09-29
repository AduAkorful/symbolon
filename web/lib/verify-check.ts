import type { PublicClient } from "viem";
import { checkInvoice, symbolonContracts, type Deployment, type InvoiceCheck } from "@symbolon/chain";
import { decodeSealedInvoice, verifySealedInvoice, type Issue, type Verification } from "@symbolon/seal";

// Plan 05i, V11. What the public verify page tells a person about an invoice file. It runs in their browser against the public RPC
// and the registry's deployment; nothing here talks to Symbolon's server.

export type CheckResult =
  /** Sealed by this Seal, reconciles, for this chain and ledger. `ledger` is what Arc says about it, or why we couldn't read that. */
  | { kind: "genuine"; check: InvoiceCheck; ledger: { ok: true } | { ok: false; reason: string } }
  /** A Symbolon envelope whose contents don't match its signature, or whose numbers don't add up */
  | { kind: "modified"; verification: Verification; issues: Issue[] }
  /** Well-formed and signed, but for another chain or ledger than this deployment's: it can't be paid here */
  | { kind: "elsewhere"; verification: Verification; issues: Issue[] }
  /** Not a Symbolon invoice at all */
  | { kind: "unsealed"; reason: string };

/** Parses text the way the page receives it: a `.symbolon` file's JSON, or JSON pasted in */
export function readEnvelope(text: string): { ok: true; envelope: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "That file is empty." };
  if (trimmed.length > 2_000_000) return { ok: false, reason: "That file is too large to be an invoice." };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "That isn't a Symbolon invoice file. Symbolon files are JSON with a .symbolon ending." };
  }
  try {
    decodeSealedInvoice(value);
  } catch {
    return { ok: false, reason: "That is JSON, but not a sealed Symbolon invoice." };
  }
  return { ok: true, envelope: value };
}

export async function runCheck(client: PublicClient, deployment: Deployment, text: string): Promise<CheckResult> {
  const read = readEnvelope(text);
  if (!read.ok) return { kind: "unsealed", reason: read.reason };
  const expected = { chainId: deployment.chainId, ledger: deployment.contracts.invoiceLedger };

  let check: InvoiceCheck | undefined;
  let ledgerError: string | undefined;
  try {
    check = await checkInvoice(client, symbolonContracts(client, deployment), deployment, read.envelope);
  } catch {
    ledgerError = "Can't read the ledger on Arc right now.";
  }
  // If the ledger couldn't be read, the signature can still be checked on its own (an EOA needs no network)
  const verification = check?.verification ?? (await verifySealedInvoice(read.envelope, { expected }));

  if (verification.ok) {
    return { kind: "genuine", check: check ?? { verification, settlements: [] }, ledger: ledgerError ? { ok: false, reason: ledgerError } : { ok: true } };
  }
  const elsewhere = verification.issues.some((i) => i.code === "chain_mismatch");
  return { kind: elsewhere ? "elsewhere" : "modified", verification, issues: verification.issues };
}
