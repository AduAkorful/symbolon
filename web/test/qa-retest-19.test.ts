import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { arcTestnet } from "@symbolon/chain";
import { businesses, createTestDb } from "@symbolon/db";

import { AnchorProof } from "@/components/decisions/AnchorProof";
import { describeInputs, formatInputValue, formatOutcome } from "@/lib/decision-inputs";
import { validatePolicySanity } from "@/lib/server/policy-edit";
import { subjectRefs } from "@/lib/server/subject-label";

// QA Retest 19 (17 Oct): the decision record's raw values, the Reference without Copy, the Policy warnings

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const ROOT = "0x6c34bcb4" + "a1".repeat(26) + "2233";
const TX = "0xfeeaee1aaafbb216c5ed8026be6fe34f0b805350588cd15ba476e86c5286d659";

describe("Decision record: the outcome reads like the rest of the app", () => {
  it("formats the scheduled time and words the code", () => {
    expect(formatOutcome("scheduled for 2026-10-27T16:49:15.000Z")).toBe("Scheduled for 27 Oct, 16:49 UTC");
    expect(formatOutcome("awaiting_approval")).toBe("Awaiting approval");
    expect(formatOutcome("")).toBe("");
  });
});

describe("Decision record: inputs are labelled and in words, raw kept", () => {
  const inputs = {
    credit: "41150000",
    dueDate: 1793119755,
    reserveYieldBps: 450,
    blockers: [
      { rule: "UnsupportedToken", detail: "token 0x89b5 not supported" },
      { rule: "PerTxCapExceeded", detail: "over cap" },
    ],
  };

  it("gives friendly labels and formatted values", () => {
    const rows = describeInputs(inputs, "USDC");
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.credit).toMatchObject({ label: "Amount owed", value: "$41.15", raw: "41150000" });
    expect(by.dueDate!.label).toBe("Due date");
    expect(by.dueDate!.value).toMatch(/^\d{1,2} [A-Z][a-z]{2} 20\d\d$/);
    expect(by.dueDate!.raw).toBe("1793119755");
    expect(by.reserveYieldBps).toMatchObject({ label: "Reserve yield", value: "4.5%" });
    expect(by.blockers!.label).toBe("What stood in the way");
    expect(by.blockers!.value).toContain("The Vault doesn't accept this currency.");
    expect(by.blockers!.value).not.toContain("{");
    expect(by.blockers!.raw).toContain("UnsupportedToken");
  });

  it("uses the invoice's own currency and says an empty list in words", () => {
    expect(formatInputValue("credit", "361200000", "EURC")).toBe("€361.20");
    expect(formatInputValue("blockers", [])).toBe("Nothing");
    expect(formatInputValue("timing", "pay_on_due_date")).toBe("Pay on the due date");
    expect(formatInputValue("policy", { ok: true, failures: [] })).toBe("Every Vault rule passes.");
    expect(formatInputValue("decision", ROOT)).toBe("0x6c34…2233");
  });
});

describe("Decision record: Merkle root and transaction are short with Copy", () => {
  it("renders the short form and a Copy button for each", () => {
    const html = renderToStaticMarkup(
      createElement(AnchorProof, {
        anchor: { status: "anchored", root: ROOT, count: 3, txHash: TX, proofValid: true, proof: [] } as never,
        explorerUrl: "https://testnet.arcscan.app",
      }),
    );
    expect(html).toContain("0x6c34…2233");
    expect(html).toContain("0xfeea…d659");
    expect(html).toContain(`Copy Merkle root ${ROOT}`);
    expect(html).toContain(`Copy anchoring transaction hash ${TX}`);
    expect(html).not.toContain(`>${ROOT}<`);
  });
});

describe("Steward page: a reference subject is short and can be copied", () => {
  it("labels an unknown hash in the short form with its full value to copy", async () => {
    const [b] = await db.insert(businesses).values({ name: "Kente Logistics Ltd", chainId: arcTestnet.id, vault: "0x00000000000000000000000000000000000a1901" }).returning();
    const refs = await subjectRefs(db, b!.id, [ROOT]);
    expect(refs.get(ROOT)).toEqual({ label: "Reference 0x6c34…2233", href: null, copy: ROOT });
  });
});

describe("Policy: the warnings say both figures plainly", () => {
  const base = {
    perTxCap: 640_000000n,
    autoPayLimit: 1_000_000000n,
    ownerThreshold: 10_000_000000n,
    newVendorMinPaid: 1,
    screeningMaxAge: 0n,
    newPayeeDelay: 0n,
    changeCooldown: 86_400n,
    looseningDelay: 86_400n,
    maxBridgeFee: 0n,
  };

  it("explains an owner level above the per-payment limit", () => {
    expect(validatePolicySanity(base)).toContain(
      "The owner sign-off level ($10,000.00) is above the per-payment limit ($640.00), so no payment ever reaches it: anything over $640.00 is blocked.",
    );
  });

  it("explains an auto-pay limit above the per-payment limit", () => {
    expect(validatePolicySanity(base)).toContain(
      "The auto-pay limit ($1,000.00) is above the per-payment limit ($640.00), so it never applies in full: nothing over $640.00 is paid, automatically or otherwise.",
    );
  });
});
