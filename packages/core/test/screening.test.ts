import { decodeFunctionData } from "viem";
import { describe, expect, it, vi } from "vitest";

import { symbolonVaultAbi, toTransaction } from "@symbolon/chain";
import { Risk } from "@symbolon/steward";

import { CircleScreening, riskFromCircle, screeningCall } from "../src/index.js";

// Circle's sandbox "magic" suffixes (developers.circle.com/wallets/compliance-engine/tx-screening-testing)
const SANCTIONED = "0x0000000000000000000000000000999999999999";

describe("compliance screening", () => {
  it("maps Circle's decisions onto the Vault's risk levels, failing towards caution", () => {
    const at = { screeningDate: "2026-09-26T00:00:00Z" };
    expect(riskFromCircle({ result: "DENIED", decision: { ...at, ruleName: "Circle's Sanctions Blocklist" } })).toBe(Risk.Blocked);
    expect(riskFromCircle({ result: "APPROVED", decision: { ...at, reasons: [{ riskScore: "SEVERE", riskCategories: ["SANCTIONS"] }] } })).toBe(Risk.Blocked);
    expect(riskFromCircle({ result: "APPROVED", decision: { ...at, actions: ["REVIEW"], reasons: [{ riskScore: "HIGH", riskCategories: ["GAMBLING"] }] } })).toBe(Risk.High);
    expect(riskFromCircle({ result: "APPROVED", decision: { ...at, reasons: [{ riskScore: "MEDIUM", riskCategories: ["OTHER"] }] } })).toBe(Risk.Medium);
    expect(riskFromCircle({ result: "APPROVED", decision: at })).toBe(Risk.Low);
  });

  it("calls Circle's endpoint with the key, a fresh idempotency key and the EVM chain", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body).toMatchObject({ address: SANCTIONED, chain: "ETH-SEPOLIA" });
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TEST:key:secret");
      return {
        ok: true,
        json: async () => ({ data: { result: "DENIED", decision: { ruleName: "Circle's Sanctions Blocklist", actions: ["DENY"], screeningDate: "2026-09-26T10:00:00Z", reasons: [{ riskScore: "BLOCKLIST", riskCategories: ["SANCTIONS"] }] } } }),
      };
    });
    const r = await new CircleScreening("TEST:key:secret", "ETH-SEPOLIA", fetcher as unknown as typeof fetch).screen(SANCTIONED);
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.circle.com/v1/w3s/compliance/screening/addresses");
    expect(r).toMatchObject({ risk: Risk.Blocked, result: "DENIED", categories: ["SANCTIONS"] });

    const call = screeningCall("0x5F5e2cd9F87A81724Cc48eC0C193630a60692984", "0x0000000000000000000000000000000000000001", r);
    const decoded = decodeFunctionData({ abi: symbolonVaultAbi, data: toTransaction(call).data });
    expect(decoded).toMatchObject({ functionName: "setScreening" });
    expect(decoded.args?.[1]).toBe(Risk.Blocked);
  });

  it("surfaces Circle errors instead of treating them as clean", async () => {
    const fetcher = vi.fn(async () => ({ ok: false, status: 401 }));
    await expect(new CircleScreening("bad", "ETH", fetcher as unknown as typeof fetch).screen(SANCTIONED)).rejects.toThrow(/401/);
  });
});
