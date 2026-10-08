import { describe, expect, it } from "vitest";
import { createRpcPool, judge, type RpcEndpoint } from "../src/rpc-pool.js";

class RpcError extends Error {
  constructor(message: string, public code?: number, public status?: number) {
    super(message);
  }
}

/** A fake clock the pool's waits advance, so cooldowns are tested without real waiting */
function clock() {
  let t = 1_000;
  // a wait moves the fake clock and lets real timers (the fake endpoints' own delays) run
  return { now: () => t, sleep: async (ms: number) => { t += ms; await new Promise((r) => setTimeout(r, 1)); }, advance: (ms: number) => void (t += ms) };
}

function endpoint(name: string, answer: (n: number) => unknown | Promise<unknown>) {
  let calls = 0;
  const e: RpcEndpoint & { calls: () => number } = {
    url: name,
    send: async () => {
      calls++;
      return answer(calls);
    },
    calls: () => calls,
  };
  return e;
}

describe("judging a failure", () => {
  it("returns at once on an answer about the question", () => {
    expect(judge(new RpcError("execution reverted: Paused", 3)).kind).toBe("fail");
    expect(judge(new RpcError("invalid argument 0: hex string without 0x prefix", -32602)).kind).toBe("fail");
    expect(judge(new RpcError("method not found", -32601)).kind).toBe("fail");
  });
  it("stops asking an endpoint for what it cannot do, for a while", () => {
    expect(judge(new RpcError("requested range too large", -32012))).toEqual({ kind: "unsupported", ttlMs: 300_000 });
    expect(judge(new RpcError("pruned history unavailable", 4444))).toEqual({ kind: "unsupported", ttlMs: 300_000 });
    expect(judge(new RpcError("ranges over 10000 blocks are not supported on free tier"))).toEqual({ kind: "unsupported", ttlMs: 300_000 });
  });
  it("tries another endpoint briefly when one has not reached a block yet", () => {
    expect(judge(new RpcError("header not found", -32000))).toEqual({ kind: "unsupported", ttlMs: 1_500 });
  });
  it("slows an endpoint that says slow down, and rests one that is down", () => {
    expect(judge(new RpcError("Too Many Requests", undefined, 429)).kind).toBe("rate");
    expect(judge(new RpcError("rate limit exceeded")).kind).toBe("rate");
    expect(judge(new RpcError("the request timed out")).kind).toBe("down");
    expect(judge(new RpcError("Bad Gateway", undefined, 502)).kind).toBe("down");
    expect(judge(new RpcError("fetch failed")).kind).toBe("down");
  });
});

describe("the RPC pool", () => {
  it("spreads calls over the endpoints instead of using the first", async () => {
    const c = clock();
    const slow = (name: string) => endpoint(name, async () => { await new Promise((r) => setTimeout(r, 5)); return name; });
    const [a, b, d] = [slow("a"), slow("b"), slow("c")];
    const pool = createRpcPool([a, b, d], { ...c, minGapMs: 0 });
    await Promise.all(Array.from({ length: 30 }, () => pool.send({ method: "eth_call" })));
    expect(a.calls() + b.calls() + d.calls()).toBe(30);
    for (const e of [a, b, d]) expect(e.calls()).toBeGreaterThan(3);
  });

  it("moves a rate-limited call to another endpoint and leaves the limiting one alone for a while", async () => {
    const c = clock();
    const limited = endpoint("limited", () => { throw new RpcError("Too Many Requests", undefined, 429); });
    const fine = endpoint("fine", () => "ok");
    const pool = createRpcPool([limited, fine], { ...c, minGapMs: 0 });
    expect(await pool.send({ method: "eth_call" })).toBe("ok");
    const afterFirst = limited.calls();
    expect(pool.status().find((s) => s.url === "limited")?.resting).toBe(true);
    for (let i = 0; i < 5; i++) expect(await pool.send({ method: "eth_call" })).toBe("ok");
    expect(limited.calls()).toBe(afterFirst); // not asked again while resting
    c.advance(31_000);
    expect(pool.status().find((s) => s.url === "limited")?.resting).toBe(false);
  });

  it("doubles the rest each time an endpoint keeps failing", async () => {
    const c = clock();
    const down = endpoint("down", () => { throw new RpcError("rate limit", undefined, 429); });
    const pool = createRpcPool([down], { ...c, minGapMs: 0, rateRestMs: 1_000, maxRateRestMs: 30_000 });
    // the one endpoint is tried twice: the first failure rests it 1 s, the second 2 s
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/rate limit/);
    expect(down.calls()).toBe(2);
    c.advance(1_500);
    expect(pool.status()[0]?.resting).toBe(true); // 2 s, not 1 s
    c.advance(600);
    expect(pool.status()[0]?.resting).toBe(false);
  });

  it("returns an answer about the question at once, without asking the others", async () => {
    const c = clock();
    const first = endpoint("first", () => { throw new RpcError("execution reverted: Paused", 3); });
    const second = endpoint("second", () => "should not be asked");
    const pool = createRpcPool([first, second], { ...c, minGapMs: 0 });
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/reverted/);
    expect(second.calls()).toBe(0);
  });

  it("stops asking an endpoint for a method it cannot answer, but still uses it for the others", async () => {
    const c = clock();
    const pruned = endpoint("pruned", (n) => { throw new RpcError("pruned history unavailable", 4444); });
    const callsOk = endpoint("pruned-calls", () => "x");
    let asked = 0;
    const prunedForLogs: RpcEndpoint & { calls: () => number } = {
      url: "node",
      send: async ({ method }) => { asked++; if (method === "eth_getLogs") throw new RpcError("pruned history unavailable", 4444); return "state"; },
      calls: () => asked,
    };
    const full = endpoint("full", () => "logs");
    const pool = createRpcPool([prunedForLogs, full], { ...c, minGapMs: 0 });
    expect(await pool.send({ method: "eth_getLogs" })).toBe("logs"); // refused once by the node, answered by the other
    const afterFirst = asked;
    for (let i = 0; i < 5; i++) expect(await pool.send({ method: "eth_getLogs" })).toBe("logs");
    expect(asked).toBe(afterFirst); // not asked for logs again
    expect(pool.status().find((x) => x.url === "node")?.skipping).toEqual(["eth_getLogs"]);
    expect(pool.status().find((x) => x.url === "node")?.resting).toBe(false);
    // the endpoint is not written off: asked on its own for another method, it answers
    const alone = createRpcPool([prunedForLogs], { ...c, minGapMs: 0 });
    expect(await alone.send({ method: "eth_call" })).toBe("state");
    // and after the skip runs out it is asked again
    c.advance(301_000);
    expect(pool.status().find((x) => x.url === "node")?.skipping).toEqual([]);
    void pruned; void callsOk;
  });

  it("slows an endpoint that rate-limits and eases it back while it keeps answering", async () => {
    const c = clock();
    let limit = 2;
    const ep = endpoint("one", () => { if (limit-- > 0) throw new RpcError("rate limit exceeded", undefined, 429); return "ok"; });
    const pool = createRpcPool([ep], { ...c, minGapMs: 100, cooldownMs: 10, maxGapMs: 2_000 });
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/rate limit/);
    expect(pool.status()[0]?.gapMs).toBe(400); // 100 -> 200 -> 400, one doubling per "slow down"
    // it answers from now on: the gap comes back down toward the base
    for (let i = 0; i < 12; i++) { c.advance(500); expect(await pool.send({ method: "eth_call" })).toBe("ok"); }
    expect(pool.status()[0]?.gapMs).toBeLessThan(150);
  });

  it("throws the last error when every endpoint failed, never a made-up result", async () => {
    const c = clock();
    const down = (n: string) => endpoint(n, () => { throw new RpcError(`${n} is down`, undefined, 503); });
    const pool = createRpcPool([down("a"), down("b")], { ...c, minGapMs: 0 });
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/is down/);
  });

  it("tries a single endpoint twice, since one failure is often a blip", async () => {
    const c = clock();
    const blip = endpoint("only", (n) => { if (n === 1) throw new RpcError("fetch failed"); return "ok"; });
    const pool = createRpcPool([blip], { ...c, minGapMs: 0, cooldownMs: 100 });
    expect(await pool.send({ method: "eth_blockNumber" })).toBe("ok");
    expect(blip.calls()).toBe(2);
  });

  it("holds one endpoint to its in-flight limit and uses the others for the rest", async () => {
    const c = clock();
    let peak = 0;
    let now = 0;
    const counted = (name: string) => endpoint(name, async () => { now++; peak = Math.max(peak, now); await new Promise((r) => setTimeout(r, 5)); now--; return name; });
    const a = counted("a");
    const pool = createRpcPool([a, counted("b")], { ...c, maxInFlight: 2, minGapMs: 0 });
    await Promise.all(Array.from({ length: 12 }, () => pool.send({ method: "eth_call" })));
    expect(peak).toBeLessThanOrEqual(4); // two endpoints, two each
  });

  it("says every endpoint is busy or resting in the words callers treat as slow-down, when nothing could be asked", async () => {
    const c = clock();
    const down = endpoint("down", () => { throw new RpcError("fetch failed"); });
    const pool = createRpcPool([down], { ...c, minGapMs: 0, cooldownMs: 20_000 });
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/fetch failed/); // asked, failed, now resting 20 s
    await expect(pool.send({ method: "eth_call" })).rejects.toThrow(/rate limit: every RPC endpoint/);
  });
});
