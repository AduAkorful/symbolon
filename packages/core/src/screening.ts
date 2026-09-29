import { randomUUID } from "node:crypto";

import type { Address } from "viem";

import { vaultCall } from "@symbolon/chain";
import { Risk } from "@symbolon/steward";

export type RiskLevel = (typeof Risk)[keyof typeof Risk];

export interface ScreeningResult {
  address: Address;
  /** The Vault's view: Low/Medium pay as normal (Medium needs an approver), High needs the owner, Blocked never pays */
  risk: RiskLevel;
  result: "APPROVED" | "DENIED";
  ruleName?: string;
  actions: string[];
  categories: string[];
  screenedAt: Date;
  provider: string;
}

export interface ScreeningProvider {
  screen(address: Address): Promise<ScreeningResult>;
}

/** Circle Compliance Engine response, per https://developers.circle.com/openapi/compliance.yaml (read 2026-09-26) */
interface CircleScreeningResponse {
  result: "APPROVED" | "DENIED";
  decision?: {
    ruleName?: string;
    actions?: string[];
    screeningDate: string;
    reasons?: { riskScore: string; riskCategories: string[] }[];
  };
}

const SCORE_ORDER = ["UNKNOWN", "LOW", "MEDIUM", "HIGH", "SEVERE", "BLOCKLIST"];

/** Maps Circle's decision onto the Vault's `Risk`: DENIED or SEVERE/BLOCKLIST → Blocked; REVIEW or HIGH → High; MEDIUM → Medium */
export function riskFromCircle(r: CircleScreeningResponse): RiskLevel {
  if (r.result === "DENIED") return Risk.Blocked;
  const actions = r.decision?.actions ?? [];
  if (actions.includes("DENY") || actions.includes("FREEZE_WALLET")) return Risk.Blocked;
  const worst = Math.max(-1, ...(r.decision?.reasons ?? []).map((x) => SCORE_ORDER.indexOf(x.riskScore)));
  if (worst >= SCORE_ORDER.indexOf("SEVERE")) return Risk.Blocked;
  if (worst === SCORE_ORDER.indexOf("HIGH") || actions.includes("REVIEW")) return Risk.High;
  if (worst === SCORE_ORDER.indexOf("MEDIUM")) return Risk.Medium;
  return Risk.Low;
}

/**
 * Circle's Compliance Engine address screening. Its chain list has no Arc entry (checked 2026-09-26), so Arc payout
 * addresses are screened as EVM addresses on `evmChain` (default ETH-SEPOLIA on testnet, ETH on mainnet): EVM
 * addresses are the same key on every chain. Confirm with Circle before mainnet.
 */
export class CircleScreening implements ScreeningProvider {
  constructor(
    private readonly apiKey: string,
    private readonly evmChain: "ETH" | "ETH-SEPOLIA" = "ETH-SEPOLIA",
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://api.circle.com",
  ) {}

  async screen(address: Address): Promise<ScreeningResult> {
    const res = await this.fetcher(`${this.baseUrl}/v1/w3s/compliance/screening/addresses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: randomUUID(), address, chain: this.evmChain }),
    });
    if (!res.ok) throw new Error(`Circle screening failed: ${res.status}`);
    const body = (await res.json()) as { data?: CircleScreeningResponse } & CircleScreeningResponse;
    const r = body.data ?? body;
    return {
      address,
      risk: riskFromCircle(r),
      result: r.result,
      ...(r.decision?.ruleName ? { ruleName: r.decision.ruleName } : {}),
      actions: r.decision?.actions ?? [],
      categories: [...new Set((r.decision?.reasons ?? []).flatMap((x) => x.riskCategories))],
      screenedAt: r.decision?.screeningDate ? new Date(r.decision.screeningDate) : new Date(),
      provider: "circle-compliance-engine",
    };
  }
}

/**
 * The screener's `setScreening(seal, risk, screenedAt)` call for a payee's payout address. Only the Vault's screener
 * role can send it; a Blocked payee can't be paid, and a stale screening blocks payment when the policy sets a max age.
 */
export function screeningCall(vault: Address, seal: Address, result: ScreeningResult) {
  return vaultCall(vault, "setScreening", [seal, result.risk, BigInt(Math.floor(result.screenedAt.getTime() / 1000))]);
}
