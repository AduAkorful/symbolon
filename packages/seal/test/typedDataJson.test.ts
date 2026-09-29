import { TypedDataEncoder } from "ethers";
import { describe, expect, it } from "vitest";

import { fingerprint, sealDomain, toInvoice, typedDataJson } from "../src/index.js";
import { chainId, ledger, sampleDocument } from "./fixtures.js";

// A wallet signs the JSON from `typedDataJson` (eth_signTypedData_v4). Its digest must be the fingerprint the ledger computes, or the
// signature it returns would never verify. ethers' TypedDataEncoder is an EIP-712 encoder that shares no code with viem or this package.

describe("typedDataJson", () => {
  it("hashes, in an independent EIP-712 encoder, to the invoice's fingerprint", () => {
    const invoice = toInvoice(sampleDocument());
    const domain = sealDomain(chainId, ledger);
    const payload = JSON.parse(typedDataJson(domain, "Invoice", invoice)) as {
      types: Record<string, { name: string; type: string }[]>;
      domain: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    };
    expect(payload.primaryType).toBe("Invoice");
    expect(payload.types.EIP712Domain).toBeDefined();
    const { EIP712Domain, ...types } = payload.types;
    void EIP712Domain;
    expect(TypedDataEncoder.hash(payload.domain, types, payload.message)).toBe(fingerprint(domain, invoice));
  });

  it("carries integers as decimal strings and the early-pay tiers as a struct list", () => {
    const invoice = toInvoice(sampleDocument());
    const payload = JSON.parse(typedDataJson(sealDomain(chainId, ledger), "Invoice", invoice)) as { message: Record<string, unknown> };
    expect(typeof payload.message.amount).toBe("string");
    expect(payload.message.amount).toMatch(/^\d+$/);
    expect(Array.isArray(payload.message.earlyPay)).toBe(true);
    expect((payload.message.earlyPay as { discountBps: unknown }[]).map((t) => t.discountBps)).toEqual([150, 75]);
  });
});
