import { concatHex, numberToHex, pad, size, sliceHex, hexToBigInt, type Hex } from "viem";
import { describe, expect, it, vi } from "vitest";

import {
  decodeSealedInvoice,
  encodeSealedInvoice,
  ERC1271_MAGIC_VALUE,
  fingerprint,
  recoverSealSigner,
  sealDomain,
  sealInvoice,
  SealError,
  deriveInvoice,
  signSealMessage,
  typedData,
  verifySealedInvoice,
  verifySealSignature,
  type SignatureClient,
} from "../src/index.js";
import { chainId, ledger, mutate, other, sampleDocument, seal } from "./fixtures.js";

const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

async function sealed() {
  return sealInvoice({ signer: seal, chainId, ledger, document: sampleDocument() });
}

/** The same signature with s mirrored to the high half: valid for raw ecrecover, rejected by OpenZeppelin */
function highS(signature: Hex): Hex {
  const r = sliceHex(signature, 0, 32);
  const s = hexToBigInt(sliceHex(signature, 32, 64));
  const v = Number(hexToBigInt(sliceHex(signature, 64, 65)));
  return concatHex([r, pad(numberToHex(SECP256K1_ORDER - s), { size: 32 }), numberToHex(v === 27 ? 28 : 27, { size: 1 })]);
}

function client(opts: { code?: Hex; result?: Hex; reverts?: boolean }): SignatureClient & { calls: number } {
  const c = {
    calls: 0,
    getCode: vi.fn(async () => opts.code),
    call: vi.fn(async () => {
      c.calls += 1;
      if (opts.reverts) throw new Error("execution reverted");
      return { data: opts.result };
    }),
  };
  return c as unknown as SignatureClient & { calls: number };
}

const MAGIC_WORD = `${ERC1271_MAGIC_VALUE}${"0".repeat(56)}` as Hex;

describe("sealing and verifying", () => {
  it("round-trips: seal, encode, decode, verify", async () => {
    const { sealed: s, invoice, fingerprint: fp } = await sealed();
    const result = await verifySealedInvoice(encodeSealedInvoice(s), { expected: { chainId, ledger } });
    expect(result).toMatchObject({ ok: true, issues: [], fingerprint: fp, seal: seal.address, method: "ecdsa" });
    expect(result.invoice).toEqual(invoice);
    expect(decodeSealedInvoice(encodeSealedInvoice(s))).toEqual(s);
  });

  it("refuses to seal with a key that isn't the document's Seal, for another chain, or when it doesn't reconcile", async () => {
    await expect(sealInvoice({ signer: other, chainId, ledger, document: sampleDocument() })).rejects.toThrow(SealError);
    await expect(sealInvoice({ signer: seal, chainId: 1, ledger, document: sampleDocument() })).rejects.toThrow(SealError);
    const broken = mutate(sampleDocument(), (d) => (d.total = "1.000000"));
    await expect(sealInvoice({ signer: seal, chainId, ledger, document: broken })).rejects.toThrow(SealError);
  });

  it("fails any tampered document, including the payout address", async () => {
    const { sealed: s } = await sealed();
    const tampered = { ...s, document: mutate(s.document, (d) => (d.payout.address = `0x${"66".repeat(20)}`)) };
    const result = await verifySealedInvoice(tampered);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toEqual(["signature"]);
  });

  it("reports arithmetic issues on a genuinely signed but inconsistent document", async () => {
    const doc = mutate(sampleDocument(), (d) => (d.lineItems[0].amount = "3300.000000"));
    // sign the inconsistent document's struct directly, bypassing the composer's checks
    const signature = await signSealMessage(seal, typedData(sealDomain(chainId, ledger), "Invoice", deriveInvoice(doc)));
    const result = await verifySealedInvoice({ v: 1, chainId, ledger: ledger.toLowerCase(), document: doc, signature });
    expect(result.ok).toBe(false);
    expect(result.method).toBe("ecdsa");
    expect(result.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["line_amount", "subtotal"]));
  });

  it("flags an envelope for another deployment or a document for another chain", async () => {
    const { sealed: s } = await sealed();
    const wrongLedger = await verifySealedInvoice(s, { expected: { chainId, ledger: other.address } });
    expect(wrongLedger.issues.map((i) => i.code)).toContain("chain_mismatch");
    const otherChain = await verifySealedInvoice({ ...s, chainId: 1 });
    expect(otherChain.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["chain_mismatch", "signature"]));
  });

  it("returns schema issues rather than throwing for malformed input", async () => {
    for (const input of ["not json", "{}", { v: 2 }, null, 42]) {
      const result = await verifySealedInvoice(input);
      expect(result.ok).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    }
    const { sealed: s } = await sealed();
    const upper = await verifySealedInvoice({ ...s, signature: s.signature.toUpperCase().replace("0X", "0x") });
    expect(upper.issues[0]?.code).toBe("schema");
  });
});

describe("ECDSA rules match OpenZeppelin", () => {
  it("rejects the high-s twin of a valid signature", async () => {
    const { sealed: s, fingerprint: fp } = await sealed();
    expect(await recoverSealSigner(fp, s.signature)).toBe(seal.address);
    expect(await recoverSealSigner(fp, highS(s.signature))).toBeUndefined();
  });

  it("rejects v of 0/1, 64-byte compact signatures and junk", async () => {
    const { sealed: s, fingerprint: fp } = await sealed();
    const v = Number(hexToBigInt(sliceHex(s.signature, 64, 65)));
    const yParity = concatHex([sliceHex(s.signature, 0, 64), numberToHex(v - 27, { size: 1 })]);
    expect(await recoverSealSigner(fp, yParity)).toBeUndefined();
    expect(await recoverSealSigner(fp, sliceHex(s.signature, 0, 64))).toBeUndefined();
    expect(await recoverSealSigner(fp, "0x")).toBeUndefined();
    expect(await recoverSealSigner(fp, `0x${"00".repeat(65)}`)).toBeUndefined();
    expect(size(s.signature)).toBe(65);
  });
});

describe("contract wallets (ERC-1271)", () => {
  async function smartWalletCase() {
    const { invoice } = await sealed();
    const fp = fingerprint(sealDomain(chainId, ledger), invoice);
    return { fp, signature: `0x${"ab".repeat(80)}` as Hex };
  }

  it("tries ECDSA first, so a delegated EOA never needs the wallet call", async () => {
    const { sealed: s, fingerprint: fp } = await sealed();
    const c = client({ code: "0xef0100", reverts: true });
    expect(await verifySealSignature({ signer: seal.address, digest: fp, signature: s.signature, client: c })).toEqual({
      valid: true,
      method: "ecdsa",
    });
    expect(c.calls).toBe(0);
  });

  it("accepts a wallet returning the magic value in a full word", async () => {
    const { fp, signature } = await smartWalletCase();
    const c = client({ code: "0x6001", result: MAGIC_WORD });
    expect(await verifySealSignature({ signer: other.address, digest: fp, signature, client: c })).toEqual({
      valid: true,
      method: "erc1271",
    });
  });

  it.each<[string, { code?: Hex; result?: Hex; reverts?: boolean }]>([
    ["no code", { result: MAGIC_WORD }],
    ["empty code", { code: "0x", result: MAGIC_WORD }],
    ["revert", { code: "0x6001", reverts: true }],
    ["short return", { code: "0x6001", result: ERC1271_MAGIC_VALUE }],
    ["wrong magic", { code: "0x6001", result: `0xffffffff${"0".repeat(56)}` }],
    ["empty return", { code: "0x6001", result: "0x" }],
  ])("rejects a wallet with %s", async (_name, opts) => {
    const { fp, signature } = await smartWalletCase();
    const result = await verifySealSignature({ signer: other.address, digest: fp, signature, client: client(opts) });
    expect(result.valid).toBe(false);
  });

  it("says a contract-wallet check needs a chain connection when no client is given", async () => {
    const { fp, signature } = await smartWalletCase();
    const result = await verifySealSignature({ signer: other.address, digest: fp, signature });
    expect(result).toMatchObject({ valid: false });
    expect(result.valid === false && result.reason).toMatch(/chain connection/);
  });
});
