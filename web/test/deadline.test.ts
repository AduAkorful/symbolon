import { describe, expect, it } from "vitest";

import { withDeadline } from "@/lib/server/deadline";

const later = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("a slow read is a failed read (A6)", () => {
  it("returns what a read gives when it finishes in time", async () => {
    expect(await withDeadline(later(5, "ok"), 500)).toBe("ok");
  });

  it("rejects, naming what was being read, when it doesn't finish in time", async () => {
    await expect(withDeadline(later(300, "late"), 20, "Reading the Vault")).rejects.toThrow(/Reading the Vault took longer than/);
  });

  it("passes a failure through, and a late failure never becomes an unhandled rejection", async () => {
    await expect(withDeadline(Promise.reject(new Error("rpc down")), 500)).rejects.toThrow("rpc down");
    const slowFailure = new Promise((_, reject) => setTimeout(() => reject(new Error("too late")), 60));
    await expect(withDeadline(slowFailure, 10)).rejects.toThrow(/took longer/);
    await later(120, null); // the dropped read fails here; vitest would report an unhandled rejection
  });

  it("reads in parallel: ten 50 ms reads take about one read, not ten", async () => {
    const started = Date.now();
    await Promise.all(Array.from({ length: 10 }, () => withDeadline(later(50, 1), 1_000)));
    expect(Date.now() - started).toBeLessThan(400);
  });
});
