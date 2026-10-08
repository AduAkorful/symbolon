import { keccak256, toHex } from "viem";
import { describe, expect, it } from "vitest";
import { releases } from "@symbolon/chain";
import { displayReleaseNotes, notesBlocks } from "@/lib/release-notes";

describe("release notes display (plan 05zc §1)", () => {
  it("leaves out plan references and nothing else", () => {
    const shown = displayReleaseNotes("The first Vault implementation (plans 01, 01a, 01b).\n\nAdds a reserve (plan 04). Everything stays.");
    expect(shown.text).toBe("The first Vault implementation.\n\nAdds a reserve. Everything stays.");
    expect(shown.trimmed).toBe(true);
  });

  it("does not touch notes with no plan reference, or parentheses that are not one", () => {
    const text = "Allows a longer delay (up to 30 days) and a plan to rotate keys.";
    expect(displayReleaseNotes(text)).toEqual({ text, trimmed: false });
  });

  it("never alters the published text: the hash of the original still matches, and no published release shows a plan reference", () => {
    for (const release of Object.values(releases)) {
      const published = release.notes;
      const before = keccak256(toHex(published));
      const shown = displayReleaseNotes(published);
      expect(keccak256(toHex(published))).toBe(before);
      expect(shown.text).not.toMatch(/\bplans?\s+\d/i);
    }
  });

  it("splits notes into paragraphs and bullets, dropping the title and joining wrapped lines", () => {
    expect(notesBlocks("# Release 2\n\nAdds a thing.\n\n- First point that\n  wraps here.\n- Second point.")).toEqual([
      { kind: "paragraph", text: "Adds a thing." },
      { kind: "list", items: ["First point that wraps here.", "Second point."] },
    ]);
  });
});
