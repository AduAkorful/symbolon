import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getAddress } from "viem";
import { describe, expect, it } from "vitest";

import { decodeSealedInvoice, documentHash, verifySealedInvoice } from "../src/index.js";
import { buildVectors } from "../scripts/buildVectors.js";

const committed = JSON.parse(readFileSync(fileURLToPath(new URL("../vectors/v1.json", import.meta.url)), "utf8"));

describe("known vectors", () => {
  it("regenerate byte for byte (run `pnpm vectors` after an intentional change)", async () => {
    expect(await buildVectors()).toEqual(committed);
  });

  it("every vector envelope verifies against the vector deployment", async () => {
    const ledger = getAddress(committed.domain.verifyingContract);
    for (const [name, v] of Object.entries<any>(committed.invoices)) {
      const result = await verifySealedInvoice(v.envelope, { expected: { chainId: committed.domain.chainId, ledger } });
      expect(result.ok, name).toBe(true);
      expect(result.fingerprint).toBe(v.fingerprint);
      expect(documentHash(decodeSealedInvoice(v.envelope).document)).toBe(v.invoice.documentHash);
    }
  });

  it("pins the plain vector so a silent change to hashing can't pass by regenerating", () => {
    expect(committed.invoices.plain.fingerprint).toBe("0x04078c68405cd9f223c7d6aeddca539c90cbc8318c810545e46fc25bd3db9622");
  });
});
