import { AuthError } from "./errors";

// A small fixed-window limiter for actions that cost money (reading an upload calls a model). Per process and in memory: it slows one
// person down, it is not a global quota, and a restart clears it.

const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): void {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 5000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return;
  }
  if (w.count >= max) throw new AuthError(429, "That's a lot of uploads. Wait a few minutes and try again.");
  w.count++;
}

/** For tests */
export function resetRateLimits() {
  windows.clear();
}
