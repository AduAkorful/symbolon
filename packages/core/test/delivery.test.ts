import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, getAddress } from "viem";
import { deliveryConfirmCall, deliveryRejectCall } from "../src/delivery.js";

const VAULT = getAddress(`0x${"ab".repeat(20)}`);
const FP = `0x${"cd".repeat(32)}` as `0x${string}`;

describe("deliveryConfirmCall", () => {
  it("returns a vaultCall for confirmDelivery with the fingerprint", () => {
    const call = deliveryConfirmCall(VAULT, FP);
    expect(call.functionName).toBe("confirmDelivery");
    expect(call.address).toBe(VAULT);
    expect(call.args[0]).toBe(FP);
  });
});

describe("deliveryRejectCall", () => {
  it("computes the reasonHash and returns the call", () => {
    const reason = "Two workstations arrived damaged.";
    const { call, reasonHash, reason: trimmed } = deliveryRejectCall(VAULT, FP, reason);
    expect(call.functionName).toBe("rejectDelivery");
    expect(call.args[0]).toBe(FP);
    expect(call.args[1]).toBe(reasonHash);
    expect(reasonHash).toBe(keccak256(stringToBytes(reason)));
    expect(trimmed).toBe(reason);
  });

  it("trims whitespace from the reason before hashing", () => {
    const { reasonHash: a } = deliveryRejectCall(VAULT, FP, "  Late.  ");
    const { reasonHash: b } = deliveryRejectCall(VAULT, FP, "Late.");
    expect(a).toBe(b);
  });

  it("throws when the reason is empty or whitespace-only", () => {
    expect(() => deliveryRejectCall(VAULT, FP, "")).toThrow();
    expect(() => deliveryRejectCall(VAULT, FP, "   ")).toThrow();
  });
});
