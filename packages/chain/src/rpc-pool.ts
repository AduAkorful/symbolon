import { custom, http, type Transport } from "viem";

/**
 * Several free public RPC endpoints used as one (plan 05zd). Arc's public endpoints are slow (200–800 ms a call), rate-limit, and
 * differ: one refuses log ranges over 10,000 blocks, one has pruned old history. Using only the first, with the others as a last
 * resort, left most of the capacity idle and made every page wait on one endpoint's worst moment. The pool:
 *
 * - sends each call to the endpoint with the least waiting in line for it (calls in flight, weighted by how fast it has answered),
 * - paces each endpoint: a few calls at once and a gap between starts that doubles whenever the endpoint says "slow down" and eases
 *   back while it keeps answering, so each free endpoint settles at the rate it tolerates (measured on Arc's public endpoints:
 *   about 3–5 calls a second each, enforced by time, not only by how many are in flight),
 * - remembers which endpoint cannot answer which method (a pruned node cannot serve old logs, a free tier refuses long ranges)
 *   and stops asking it that for a while, instead of paying a round trip per call to be refused again,
 * - on a rate-limit answer, a timeout or a server error puts that endpoint on a cooldown (doubling while it keeps failing) and
 *   tries the call on the next endpoint,
 * - on an answer that is about this endpoint, not the question (pruned history, a range over its limit, a block it hasn't
 *   reached yet), tries another endpoint without penalising it for other calls,
 * - returns at once on an answer about the question itself (a contract revert, a bad request): another endpoint would say the same.
 *
 * It never invents a result: when every endpoint has been tried it throws the last error, which the app shows as "can't confirm".
 */

export interface RpcEndpoint {
  url: string;
  /** One JSON-RPC call. Throws viem's request errors, or any error with `status`, `code` or a `message`. */
  send(args: { method: string; params?: unknown }): Promise<unknown>;
}

export interface RpcPoolOptions {
  /** Calls one endpoint may have in flight at once (default 6) */
  maxInFlight?: number;
  /** Least time between two call starts on one endpoint, in ms (default 250, about four a second); it grows under rate limiting and returns to this */
  minGapMs?: number;
  /** The most the gap may grow to (default 2,000) */
  maxGapMs?: number;
  /** First rest after an endpoint is down, in ms; doubles on each further failure (default 1,000) up to `maxCooldownMs` (default 30,000) */
  cooldownMs?: number;
  maxCooldownMs?: number;
  /** First rest after "slow down" (default 500), doubling up to `maxRateRestMs` (default 5,000): their windows are about a second */
  rateRestMs?: number;
  maxRateRestMs?: number;
  /** Clock and timer, replaceable in tests */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The longest one call waits for a resting endpoint to come back before giving up with the last error */
const MAX_WAIT_MS = 3_000;

type Verdict =
  | { kind: "fail" }
  | { kind: "rate" }
  | { kind: "down" }
  /** This endpoint cannot answer this method for now: `ttlMs` is how long to stop asking it that */
  | { kind: "unsupported"; ttlMs: number };

const text = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error);
  const e = error as Error & { details?: string; shortMessage?: string };
  return `${e.message} ${e.details ?? ""} ${e.shortMessage ?? ""}`;
};

const CAPABILITY_TTL_MS = 5 * 60_000;
const LAG_TTL_MS = 1_500;

/** What a failure means for this endpoint and for the call */
export function judge(error: unknown): Verdict {
  const e = error as { status?: number; code?: number; name?: string } | undefined;
  const message = text(error);
  // about the question, not the endpoint: the same answer would come from anywhere
  if (/execution reverted|revert|invalid (?:params|argument|request)|method not found|nonce too|insufficient funds|already known|invalid sender/i.test(message) && !/pruned|missing trie|header not found/i.test(message)) return { kind: "fail" };
  if (e?.code === -32602 || e?.code === -32601 || e?.code === 3) return { kind: "fail" };
  // this endpoint cannot do this: pruned history, a range over its limit
  if (/pruned history|history unavailable|requested range too large|ranges? over|range (?:is )?too (?:large|wide)|exceeds? .*(?:block )?range|block range|too many results|response size|query returned more than|missing trie node/i.test(message) || e?.code === 4444 || e?.code === -32012) return { kind: "unsupported", ttlMs: CAPABILITY_TTL_MS };
  // this endpoint has not reached that block yet (they trail each other by a few blocks): another may have
  if (/header not found|unknown block|block not found|not (?:yet )?(?:synced|available)/i.test(message)) return { kind: "unsupported", ttlMs: LAG_TTL_MS };
  // told to slow down
  if (e?.status === 429 || /rate limit|too many requests|\b429\b|exceeds defined limit/i.test(message)) return { kind: "rate" };
  // slow or down
  if ((e?.status !== undefined && e.status >= 500) || e?.status === 408 || /timed out|timeout|fetch failed|network|econn|enotfound|socket|overloaded|temporarily unavailable|service unavailable|bad gateway|gateway time-?out/i.test(message) || e?.name === "TimeoutError" || e?.name === "HttpRequestError") return { kind: "down" };
  // a JSON-RPC internal error is the node's trouble
  if (e?.code === -32603 || e?.code === -32000 || e?.code === -32005) return { kind: "unsupported", ttlMs: LAG_TTL_MS };
  return { kind: "fail" };
}

interface State {
  endpoint: RpcEndpoint;
  inFlight: number;
  nextStartAt: number;
  /** The gap this endpoint is held to between call starts right now */
  gap: number;
  coolUntil: number;
  failures: number;
  /** Methods this endpoint cannot answer for now, and until when */
  skip: Map<string, number>;
  /** Smoothed answer time in ms; starts at a guess so every endpoint gets tried */
  latency: number;
}

export function createRpcPool(endpoints: RpcEndpoint[], opts: RpcPoolOptions = {}) {
  if (endpoints.length === 0) throw new Error("an RPC pool needs at least one endpoint");
  const maxInFlight = opts.maxInFlight ?? 6;
  const baseGap = opts.minGapMs ?? 250;
  const maxGap = opts.maxGapMs ?? 2_000;
  const baseCooldown = opts.cooldownMs ?? 1_000;
  const maxCooldown = opts.maxCooldownMs ?? 30_000;
  const baseRateRest = opts.rateRestMs ?? 500;
  const maxRateRest = opts.maxRateRestMs ?? 5_000;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const states: State[] = endpoints.map((endpoint) => ({ endpoint, inFlight: 0, nextStartAt: 0, gap: baseGap, coolUntil: 0, failures: 0, skip: new Map<string, number>(), latency: 300 }));

  /** The endpoint a call should go to now: not resting, not already tried for this call, least waiting in line */
  const pick = (tried: Set<State>, method: string): State | null => {
    const t = now();
    let best: State | null = null;
    let bestScore = Infinity;
    for (const s of states) {
      if (tried.has(s) || s.coolUntil > t || s.inFlight >= maxInFlight || (s.skip.get(method) ?? 0) > t) continue;
      const score = (s.inFlight + 1) * s.latency;
      if (score < bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return best;
  };

  async function send(args: { method: string; params?: unknown }): Promise<unknown> {
    const tried = new Set<State>();
    let lastError: unknown;
    // every endpoint at most once per call; a pool of one endpoint tries it twice (a single failure is often a blip)
    const maxSends = Math.max(states.length, 2);
    let sends = 0;
    let waited = 0;
    while (sends < maxSends) {
      const state = pick(tried, args.method);
      if (!state) {
        const left = states.filter((s) => !tried.has(s));
        if (left.length === 0) {
          if (states.length === 1 && sends < maxSends) {
            tried.clear();
            await sleep(baseGap * 4);
            continue;
          }
          break;
        }
        // what is left is resting or full: wait for the soonest to come back rather than fail a call that would work, but not for long
        const t = now();
        const wake = Math.max(10, Math.min(...left.map((s) => (s.coolUntil > t ? s.coolUntil - t : 20))));
        if (waited + wake > MAX_WAIT_MS) break;
        waited += wake;
        await sleep(wake);
        continue;
      }
      // space out starts on one endpoint
      const wait = state.nextStartAt - now();
      state.nextStartAt = Math.max(state.nextStartAt, now()) + state.gap;
      if (wait > 0) await sleep(wait);

      sends++;
      state.inFlight++;
      const startedAt = now();
      try {
        const result = await state.endpoint.send(args);
        state.latency = state.latency * 0.7 + (now() - startedAt) * 0.3;
        state.failures = 0;
        state.gap = Math.max(baseGap, state.gap * 0.9); // eases back while it keeps answering
        return result;
      } catch (error) {
        lastError = error;
        const verdict = judge(error);
        if (verdict.kind === "fail") throw error;
        tried.add(state);
        if (verdict.kind === "unsupported") {
          state.skip.set(args.method, now() + verdict.ttlMs);
        } else {
          state.failures++;
          if (verdict.kind === "rate") {
            state.coolUntil = now() + Math.min(baseRateRest * 2 ** (state.failures - 1), maxRateRest);
            state.gap = Math.min(maxGap, state.gap * 2);
          } else {
            state.coolUntil = now() + Math.min(baseCooldown * 2 ** (state.failures - 1), maxCooldown);
          }
        }
      } finally {
        state.inFlight--;
      }
    }
    // Nothing was asked, or everything asked failed. When it is only that every endpoint able to answer is busy or resting, say so
    // in the words callers already treat as "slow down and ask again" (the log scanner waits and retries on them, where an
    // unknown error would make it shrink its ranges for nothing).
    throw lastError ?? new Error("rate limit: every RPC endpoint able to answer is busy or resting");
  }

  return {
    send,
    /** For tests and diagnostics */
    status: () => states.map((s) => ({ url: s.endpoint.url, inFlight: s.inFlight, resting: s.coolUntil > now(), gapMs: Math.round(s.gap), latency: Math.round(s.latency), skipping: [...s.skip].filter(([, until]) => until > now()).map(([m]) => m) })),
  };
}

/** A real endpoint: viem's own HTTP transport (so its errors keep their shape), with no retries of its own: the pool decides those */
export function httpEndpoint(url: string, opts: { timeoutMs?: number | undefined } = {}): RpcEndpoint {
  const transport = http(url, { retryCount: 0, timeout: opts.timeoutMs ?? 8_000 })({ retryCount: 0 }) as unknown as { request(args: { method: string; params?: unknown }): Promise<unknown> };
  return { url, send: (args) => transport.request(args) };
}

/** A viem transport over a pool of the given URLs */
export function poolTransport(urls: string[], opts: RpcPoolOptions & { timeoutMs?: number } = {}): Transport {
  const pool = createRpcPool(urls.map((u) => httpEndpoint(u, { timeoutMs: opts.timeoutMs })), opts);
  return custom({ request: (args: { method: string; params?: unknown }) => pool.send(args) }, { retryCount: 0 });
}
