import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { ProtocolNumbers } = await import("@/components/public/ProtocolNumbers");
import type { ProtocolStats } from "@/lib/server/stats";

const EXPLORER = "https://explorer.testnet.arc.io";
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const addr = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

function stats(numbers: Partial<NonNullable<ProtocolStats["numbers"]>>): ProtocolStats {
  return {
    network: { name: "Arc Testnet", chainId: 5042002, testnet: true },
    explorer: EXPLORER,
    readThrough: "1",
    head: "1",
    progressPercent: 100,
    state: "ready",
    numbers: { vaultsCreated: 0, invoicesSettled: 0, volume: [], otherTokenSettlements: 0, sealsPaid: 0, payingVaults: 0, firstSettlement: null, latest: [], locked: null, ...numbers },
  };
}
const html = (s: ProtocolStats) => renderToStaticMarkup(createElement(ProtocolNumbers, { stats: s }));

describe("the landing page's network numbers (plan 05zg)", () => {
  it("shows two headline figures, the latest settlements linked to their transactions, and one quiet line with correct plurals", () => {
    const out = html(
      stats({
        vaultsCreated: 5,
        invoicesSettled: 1,
        volume: [{ token: "USDC", amount: "1", settled: 1 }],
        sealsPaid: 1,
        payingVaults: 1,
        firstSettlement: "2026-09-26T07:01:53.000Z",
        latest: [{ txHash: hash(7), at: "2026-09-26T07:01:53.000Z", token: "USDC", amount: "1", seal: addr(2), payer: addr(3) }],
      }),
    );
    expect(out).toContain("Vaults created");
    expect(out).toContain("Invoices settled");
    expect(out).toContain("1 USDC paid · 1 vendor paid · 1 Vault has paid · first settlement 26 Sep 2026");
    expect(out).toContain(`href="${EXPLORER}/tx/${hash(7)}"`);
    expect(out).toContain("Latest settlements");
  });

  it("uses the plural forms and keeps each token's total apart", () => {
    const out = html(stats({ invoicesSettled: 3, volume: [{ token: "EURC", amount: "0.75", settled: 1 }, { token: "USDC", amount: "1250.5", settled: 2 }], sealsPaid: 2, payingVaults: 2, otherTokenSettlements: 1 }));
    expect(out).toContain("0.75 EURC paid · 1,250.5 USDC paid · 1 settlement in another token · 2 vendors paid · 2 Vaults have paid");
  });

  it("shows the value locked per token, never added together, and nothing at all when it could not be read", () => {
    const out = html(stats({ vaultsCreated: 5, locked: { vaults: 5, tokens: [{ token: "USDC", amount: "1250.5" }, { token: "EURC", amount: "0.75" }] } }));
    expect(out).toContain("Value locked in Vaults");
    expect(out).toContain("1,250.5");
    expect(out).toContain("0.75 EURC");
    expect(out).toContain("Held by 5 Vaults right now");
    expect(out).toContain("Each token is counted alone");
    expect(html(stats({ vaultsCreated: 5, locked: null }))).not.toContain("Value locked");
    expect(html(stats({ locked: { vaults: 1, tokens: [{ token: "USDC", amount: "1" }, { token: "EURC", amount: "0" }] } }))).toContain("Held by 1 Vault right now");
  });

  it("lists a settlement in an unnamed token without an amount", () => {
    const out = html(stats({ invoicesSettled: 1, otherTokenSettlements: 1, latest: [{ txHash: hash(1), at: null, token: null, amount: null, seal: addr(2), payer: addr(3) }] }));
    expect(out).toContain("Another token");
    expect(out).toContain("Date unknown");
  });

  it("says plainly that nothing has settled, and lists nothing, when nothing has", () => {
    const out = html(stats({ vaultsCreated: 2 }));
    expect(out).toContain("No invoice has been settled yet.");
    expect(out).not.toContain("Latest settlements");
  });
});
