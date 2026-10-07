import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { livePurchaseOrderEvidence } from "@/lib/server/po-evidence";

const VAULT = "0x1111111111111111111111111111111111111111";
const REF = `0x${"ab".repeat(32)}` as const;
const row = (over: Partial<{ closedAt: Date | null }> = {}) => ({ poNumber: "PO-1042", releaseAfter: null, openTx: null, closedAt: null, ...over });
const contractsWith = (read: () => Promise<{ open: boolean; remaining: bigint }>) => ({ lens: { read: { getPurchaseOrder: read } } }) as never;

describe("purchase-order evidence (plan 05y Q1)", () => {
  it("takes open and remaining from the Vault when the read works", async () => {
    const e = await livePurchaseOrderEvidence(contractsWith(async () => ({ open: true, remaining: 600_000_000n })), VAULT, REF, row());
    expect(e).toMatchObject({ open: true, remainingRaw: "600000000", poNumber: "PO-1042" });
  });

  it("does not fall back to the database's open state when the read fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = await livePurchaseOrderEvidence(contractsWith(async () => { throw new Error("rpc down"); }), VAULT, REF, row({ closedAt: null }));
    log.mockRestore();
    expect(e.open).toBe(false);
    expect(e.remainingRaw).toBeNull();
    expect(e.closedAt).toBeNull();
  });

  it("keeps the stored close date, because a closed PO stays closed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const closed = new Date("2026-09-01T00:00:00Z");
    const e = await livePurchaseOrderEvidence(contractsWith(async () => { throw new Error("rpc down"); }), VAULT, REF, row({ closedAt: closed }));
    log.mockRestore();
    expect(e.closedAt).toEqual(closed);
  });
});
