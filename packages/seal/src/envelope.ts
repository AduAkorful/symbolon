import { getAddress, isAddressEqual, type Address, type Hex } from "viem";
import { z } from "zod";

import { canonicalJson } from "./canonical.js";
import { checkDocument, deriveInvoice, parseDocument, toInvoice, type InvoiceDocument } from "./document.js";
import { SealError, type Issue } from "./errors.js";
import { signSealMessage, verifySealSignature, type SealSigner, type SignatureClient } from "./signature.js";
import { fingerprint, sealDomain, typedData, type Invoice } from "./typedData.js";

const ENVELOPE_VERSION = 1;

/** A sealed invoice as it travels (link, file, email): the document plus the Seal's signature and its domain */
export interface SealedInvoice {
  v: typeof ENVELOPE_VERSION;
  chainId: number;
  ledger: string;
  document: InvoiceDocument;
  signature: Hex;
}

const envelopeSchema = z.strictObject({
  v: z.literal(ENVELOPE_VERSION),
  chainId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  ledger: z.string().regex(/^0x[0-9a-f]{40}$/),
  document: z.unknown(),
  signature: z.string().regex(/^0x(?:[0-9a-f]{2})+$/),
});

/**
 * Seals a document: derives the invoice, checks it reconciles and belongs to this chain and signer, and signs it.
 * Returns the envelope and the fingerprint the ledger will key it by.
 */
export async function sealInvoice(args: {
  signer: SealSigner;
  chainId: number;
  ledger: Address;
  document: InvoiceDocument;
}): Promise<{ sealed: SealedInvoice; invoice: Invoice; fingerprint: Hex }> {
  const document = parseDocument(args.document);
  const invoice = toInvoice(document);
  if (document.currency.chainId !== args.chainId) {
    throw new SealError(`document is for chain ${document.currency.chainId}, not ${args.chainId}`);
  }
  if (args.signer.address !== undefined && !isAddressEqual(args.signer.address, invoice.seal)) {
    throw new SealError(`signer ${args.signer.address} is not the document's Seal ${invoice.seal}`);
  }
  const domain = sealDomain(args.chainId, args.ledger);
  const signature = await signSealMessage(args.signer, typedData(domain, "Invoice", invoice));
  const sealed: SealedInvoice = {
    v: ENVELOPE_VERSION,
    chainId: args.chainId,
    ledger: args.ledger.toLowerCase(),
    document,
    signature,
  };
  return { sealed, invoice, fingerprint: fingerprint(domain, invoice) };
}

/** The envelope's canonical JSON, byte-stable across encoders */
export function encodeSealedInvoice(sealed: SealedInvoice): string {
  return canonicalJson(sealed);
}

/** Parses and strictly validates an envelope (including its document). Throws on anything malformed. */
export function decodeSealedInvoice(input: string | unknown): SealedInvoice {
  let value: unknown = input;
  if (typeof input === "string") {
    try {
      value = JSON.parse(input);
    } catch {
      throw new SealError("sealed invoice is not valid JSON");
    }
  }
  const envelope = envelopeSchema.safeParse(value);
  if (!envelope.success) {
    throw new SealError(
      "invalid sealed invoice",
      envelope.error.issues.map((i) => ({ code: "schema", path: i.path.map(String).join("."), message: i.message })),
    );
  }
  return { ...envelope.data, v: ENVELOPE_VERSION, document: parseDocument(envelope.data.document), signature: envelope.data.signature as Hex };
}

export interface Verification {
  /** True only when the document is well-formed, reconciles, matches the expected deployment and is validly sealed */
  ok: boolean;
  issues: Issue[];
  document?: InvoiceDocument;
  invoice?: Invoice;
  fingerprint?: Hex;
  seal?: Address;
  method?: "ecdsa" | "erc1271";
}

/**
 * Everything the verify page and the Steward check before trusting an invoice file. Nothing in the envelope is taken
 * as given: the invoice and fingerprint are recomputed from the document. `expected` pins the real deployment; an
 * envelope naming another ledger may be genuinely signed but can never settle on Symbolon's.
 */
export async function verifySealedInvoice(
  input: string | unknown,
  options: { client?: SignatureClient; expected?: { chainId: number; ledger: Address } } = {},
): Promise<Verification> {
  let sealed: SealedInvoice;
  try {
    sealed = decodeSealedInvoice(input);
  } catch (error) {
    if (error instanceof SealError) {
      const issues: Issue[] = error.issues.length > 0 ? [...error.issues] : [{ code: "schema", path: "", message: error.message }];
      return { ok: false, issues };
    }
    throw error;
  }

  const { document } = sealed;
  const issues: Issue[] = checkDocument(document);
  if (document.currency.chainId !== sealed.chainId) {
    issues.push({ code: "chain_mismatch", path: "currency.chainId", message: `document is for chain ${document.currency.chainId}, envelope for ${sealed.chainId}` });
  }
  if (options.expected !== undefined) {
    if (options.expected.chainId !== sealed.chainId || !isAddressEqual(options.expected.ledger, getAddress(sealed.ledger))) {
      issues.push({ code: "chain_mismatch", path: "ledger", message: "sealed for a different chain or ledger than Symbolon's" });
    }
  }

  const invoice = deriveInvoice(document);
  const fp = fingerprint(sealDomain(sealed.chainId, getAddress(sealed.ledger)), invoice);
  const check = await verifySealSignature({ signer: invoice.seal, digest: fp, signature: sealed.signature, client: options.client });
  if (!check.valid) issues.push({ code: "signature", path: "signature", message: check.reason });

  return {
    ok: issues.length === 0,
    issues,
    document,
    invoice,
    fingerprint: fp,
    seal: getAddress(invoice.seal),
    ...(check.valid ? { method: check.method } : {}),
  };
}
