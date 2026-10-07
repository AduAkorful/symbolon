import { beforeEach, describe, expect, it, vi } from "vitest";
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { createTestDb } from "@symbolon/db";
import type { PublicClient } from "viem";

vi.mock("server-only", () => ({}));
const core = vi.hoisted(() => ({ syncLedger: vi.fn() }));
vi.mock("@symbolon/core", async (original) => ({ ...(await original<typeof import("@symbolon/core")>()), syncLedger: core.syncLedger }));

const cfg = { chainId: arcTestnet.id, deployment: getDeployment(arcTestnet.id) };
const client = {} as PublicClient;
const report = (to: bigint, head: bigint) => ({ from: 1n, to, head, events: 0, invoicesUpdated: 0 });

async function fresh() {
  vi.resetModules();
  const mod = await import("@/lib/server/sync");
  return { ...mod, db: await createTestDb() };
}

// braces matter: vitest runs a value returned from a hook as its cleanup
beforeEach(() => {
  core.syncLedger.mockReset();
});
vi.setConfig({ testTimeout: 60_000 });

describe("page sync is bounded (A3)", () => {
  it("asks the core for one window, not the whole history", async () => {
    const { ensureFresh, SYNC_WINDOW_BLOCKS, db } = await fresh();
    core.syncLedger.mockResolvedValue(report(100n, 100n));
    expect(await ensureFresh(db, client, cfg)).toEqual({ ok: true, catchingUp: false });
    expect(core.syncLedger.mock.calls[0]![4]).toEqual({ maxBlocks: SYNC_WINDOW_BLOCKS });
  });

  it("does not hold a page past its deadline while a sync is still reading", async () => {
    const { ensureFresh, db } = await fresh();
    let finish!: () => void;
    core.syncLedger.mockReturnValue(new Promise((resolve) => (finish = () => resolve(report(100n, 100n)))));
    const started = Date.now();
    const state = await ensureFresh(db, client, cfg, { deadlineMs: 30 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(state).toEqual({ ok: true, catchingUp: true, behind: null });
    finish(); // the background run ends quietly
  });

  it("says how far behind a partial window left the mirror, and keeps catching up on the next visit", async () => {
    const { ensureFresh, db } = await fresh();
    core.syncLedger.mockResolvedValueOnce(report(400n, 1_000n)).mockResolvedValueOnce(report(800n, 1_000n)).mockResolvedValueOnce(report(1_000n, 1_000n));
    expect(await ensureFresh(db, client, cfg)).toEqual({ ok: true, catchingUp: true, behind: 600n });
    expect(await ensureFresh(db, client, cfg)).toEqual({ ok: true, catchingUp: true, behind: 200n });
    expect(await ensureFresh(db, client, cfg)).toEqual({ ok: true, catchingUp: false });
    expect(core.syncLedger).toHaveBeenCalledTimes(3);
  });

  it("reports a failed sync as a failure, never as current", async () => {
    const { ensureFresh, db } = await fresh();
    // the rejection is made when the sync is called, not when the test is set up
    core.syncLedger.mockImplementation(async () => {
      throw new Error("rpc unavailable");
    });
    expect(await ensureFresh(db, client, cfg)).toEqual({ ok: false, reason: "rpc unavailable" });
  });

  it("syncToHead runs windows until the head, or says it isn't ready by the deadline", async () => {
    const { syncToHead, db } = await fresh();
    core.syncLedger.mockResolvedValueOnce(report(400n, 1_000n)).mockResolvedValueOnce(report(800n, 1_000n)).mockResolvedValueOnce(report(1_000n, 1_000n));
    expect(await syncToHead(db, client, cfg)).toEqual({ ok: true });
    expect(core.syncLedger).toHaveBeenCalledTimes(3);

    core.syncLedger.mockReset().mockImplementation(async () => report(400n, 1_000_000n));
    const late = await syncToHead(db, client, cfg, { deadlineMs: 50 });
    expect(late).toMatchObject({ ok: false });
    if (!late.ok) expect(late.reason).toMatch(/catching up/);
  });
});
