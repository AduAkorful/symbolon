import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/next-path";

describe("safeNext", () => {
  it.each(["/b", "/b/inbox?tab=1", "/v/invoices/0143"])("keeps a path on this site (%s)", (p) => expect(safeNext(p)).toBe(p));
  it.each([undefined, "", "b", "//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/a\nb", "/" + "x".repeat(400)])("falls back for %j", (p) => expect(safeNext(p)).toBe("/signin"));
  it("uses the first of several values and honours a different fallback", () => {
    expect(safeNext(["/b", "/v"])).toBe("/b");
    expect(safeNext("//x", "/b")).toBe("/b");
  });
});
