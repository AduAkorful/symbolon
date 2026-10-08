import { describe, expect, it } from "vitest";
import { plainRunError } from "@/lib/run-error";

describe("what a person is told when a Steward pass failed", () => {
  it("says a busy public network in plain words, with none of the library's text", () => {
    const out = plainRunError("An unknown RPC error occurred. Details: rate limit: every RPC endpoint able to answer is busy or resting Version: viem@2.56.9");
    expect(out).toMatch(/public network was busy/);
    expect(out).not.toMatch(/viem|RPC|Version|Details/);
  });
  it("says a slow answer in plain words", () => {
    expect(plainRunError("The request took too long to respond. ETIMEDOUT")).toMatch(/too long to answer/);
  });
  it("keeps the app's own sentences, and never shows library text for anything else", () => {
    expect(plainRunError("Steward wallet fee balance is too low for autonomous execution")).toBe("Steward wallet fee balance is too low for autonomous execution");
    expect(plainRunError("HTTP request failed. Version: viem@2.56.9")).toMatch(/Arc couldn't be read/);
    expect(plainRunError("Previous lease expired")).toMatch(/interrupted/);
    expect(plainRunError(null)).toBe("This check didn't finish.");
  });
});
