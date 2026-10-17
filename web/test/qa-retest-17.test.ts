import { beforeAll, describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { arcTestnet } from "@symbolon/chain";
import { businesses, chainEvents, createTestDb, decisions, invoices } from "@symbolon/db";

import { emptySignoffNote } from "@/lib/approvals-text";
import { tidyMoneyInText } from "@/lib/format";
import { foldLendingMoves, type ActivityItem } from "@/lib/server/activity";
import { loadNotYetApprovable } from "@/lib/server/approvals";
import { screeningSavedTx } from "@/lib/server/compliance";
import { summarizeDecision } from "@/lib/server/decision-text";
import { shortfallDedupeKey } from "@/lib/server/due-notices";
import { releaseTransactions } from "@/lib/server/release";
import { internalKeyLabel, subjectRefs } from "@/lib/server/subject-label";

// QA Retest 17 (17 Oct): STW-2's empty sign-off list, SYM-03's missing transaction links and the small items

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

let n = 0x17000;
const addr = () => "0x" + (n++).toString(16).padStart(40, "0");
const h = (s: string) => keccak256(toHex(s));
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a";
const ACCS = "0xc81fe21103bb5d1fd1d2344b78deb53495041cfb"; // Accra Cold Chain Supplies, 3 paid invoices
const NEW_VENDOR = "0x359045be3fad3d443bae7d597eed61c37a3abfe9"; // a payee with no paid invoice yet

async function business(mode: "auto" | "assist" | "shadow" = "auto") {
  const [b] = await db.insert(businesses).values({ name: "Kente Logistics Ltd", chainId: arcTestnet.id, vault: addr(), stewardMode: mode }).returning();
  return b!;
}

async function invoice(businessId: string, number: string, seal: string, token: string, total: bigint, status: "scheduled" | "held" = "scheduled") {
  const fingerprint = h(`${businessId}:${number}`);
  await db.insert(invoices).values({
    fingerprint, chainId: arcTestnet.id, ledger: addr(), seal, businessId, payerRef: h("payer"), invoiceNumber: number, token, total,
    dueDate: new Date("2026-10-27T00:00:00Z"), envelope: "{}", status, source: "link",
  });
  return fingerprint;
}

let at = Date.parse("2026-10-15T16:00:00Z");
async function decide(businessId: string, kind: string, subject: string, record: Record<string, unknown>) {
  const full = { kind, subject, ...record };
  await db.insert(decisions).values({ businessId, kind, subject, record: full, hash: h(JSON.stringify(full) + at), createdAt: new Date((at += 60_000)) });
}
const scheduled = (blockers: { rule: string; detail: string }[]) => ({ inputs: { blockers }, rule: "pay on the due date unless a signed discount beats the reserve yield plus the owner's spread", outcome: "scheduled for 2026-10-27T00:00:00Z" });
const signoff = { rule: "ApprovalRequired", detail: "needs a sign-off from an approver or the owner" };
const eurc = { rule: "UnsupportedToken", detail: `${EURC} isn't a payment token of this Vault` };
const overCap = { rule: "PerTxCapExceeded", detail: "780000000 over the per-payment cap 640000000" };

describe("STW-2: why the Autonomous sign-off list is empty for the Kente Logistics Vault", () => {
  it("lists nothing when every USDC invoice is within auto-pay and the rest are held back by another rule", async () => {
    const b = await business("auto");
    // three Accra Cold Chain invoices under the $640 cap: the vendor has 3 paid, so no sign-off is needed
    for (const [num, total] of [["ACCS-2026-0005", 412_750_000n], ["ACCS-2026-0007", 268_400_000n], ["ACCS-2026-0008", 357_900_000n]] as const) {
      const fp = await invoice(b.id, num, ACCS, USDC, total);
      await decide(b.id, "schedule", fp, scheduled([]));
      if (num !== "ACCS-2026-0005") await decide(b.id, "early_pay_offered", fp, { inputs: { discountBps: 180 } }); // a later, non-finding row
    }
    // three EURC invoices: the Vault doesn't pay EURC, and the vendor has nothing paid yet, so a sign-off as well
    for (const [num, total] of [["OPS-2026-014", 1_250_000_000n], ["OPS-2026-015", 486_000_000n], ["OPS-2026-016", 932_500_000n]] as const) {
      const fp = await invoice(b.id, num, NEW_VENDOR, EURC, total);
      await decide(b.id, "schedule", fp, scheduled([eurc, signoff]));
    }
    // one over the per-payment limit
    const big = await invoice(b.id, "ACCS-2026-0009", ACCS, USDC, 780_000_000n);
    await decide(b.id, "schedule", big, scheduled([overCap]));

    const r = await loadNotYetApprovable(db, b.id, { autoMode: true, canApprove: true });
    expect(r.count).toBe(7);
    expect(r.signoffAhead).toEqual([]);
    expect(r.autoPayOnDue).toBe(3);
    expect(r.signoffAndMore).toBe(3);
    expect(r.reasons).toEqual([
      { title: "Within the auto-pay rules: the Steward pays it on its due date", count: 3 },
      { title: "The Vault doesn't accept this currency", count: 3 },
      { title: "Over the per-payment limit", count: 1 },
    ]);
    expect(emptySignoffNote(r)).toBe(
      "Nothing needs signing ahead: an invoice is listed under “Coming up that need your sign-off” only when a sign-off is the one thing in its way. 3 invoices are within the auto-pay rules, so the Steward pays them on the due date without a sign-off. The other 4 are held back by something else first (listed above). 3 of them will also need a sign-off once that is cleared.",
    );
  });

  it("lists an invoice whose only blocker is a sign-off, with Sign ahead in Autonomous mode", async () => {
    const b = await business("auto");
    const fp = await invoice(b.id, "SAH-2026-0031", NEW_VENDOR, USDC, 215_600_000n);
    await decide(b.id, "schedule", fp, scheduled([signoff]));
    await decide(b.id, "early_pay_offered", fp, { inputs: { discountBps: 150 } });
    const r = await loadNotYetApprovable(db, b.id, { autoMode: true, canApprove: true });
    expect(r.signoffAhead.map((a) => [a.invoiceNumber, a.needs, a.canSign])).toEqual([["SAH-2026-0031", "approver", true]]);
    expect(r.reasons).toEqual([{ title: "Needs only a sign-off before its due date", count: 1 }]);
    expect(r.autoPayOnDue).toBe(0);
  });

  it("words a single held-back invoice without auto-pay ones", () => {
    expect(emptySignoffNote({ count: 1, autoPayOnDue: 0, signoffAndMore: 0 })).toBe(
      "Nothing needs signing ahead: an invoice is listed under “Coming up that need your sign-off” only when a sign-off is the one thing in its way. It is held back by something else first (listed above).",
    );
  });
});

describe("SYM-03: transaction links from the stored Vault history", () => {
  it("finds a screening's transaction by its ScreeningSet event", async () => {
    const b = await business();
    const vault = b.vault!;
    const tx = "0x8fd2fdece06e6636061b83cb8f242108320d413d1207d1fe9c0adf293f7a28f0";
    await db.insert(chainEvents).values([
      { chainId: arcTestnet.id, txHash: "0x" + "11".repeat(32), logIndex: 0, blockNumber: 67017504n, address: vault.toLowerCase(), eventName: "ScreeningSet", args: { seal: "0xC81fE21103Bb5d1fd1D2344B78deB53495041CFb", risk: 0, screenedAt: "1791000000" } },
      { chainId: arcTestnet.id, txHash: tx, logIndex: 0, blockNumber: 67033999n, address: vault.toLowerCase(), eventName: "ScreeningSet", args: { seal: "0xC81fE21103Bb5d1fd1D2344B78deB53495041CFb", risk: 0, screenedAt: "1791909094" } },
    ]);
    expect(await screeningSavedTx(db, b.id, vault, ACCS, null, 1791909094n)).toBe(tx);
    expect(await screeningSavedTx(db, b.id, vault, ACCS, null, 1791000000n)).toBe("0x" + "11".repeat(32));
    expect(await screeningSavedTx(db, b.id, vault, NEW_VENDOR, null, 1791911554n)).toBeNull();
  });

  it("names the upgrade that installed the running release, not the Vault's creation", async () => {
    const b = await business();
    const vault = b.vault! as `0x${string}`;
    const v3 = "0xcd81000000000000000000000000000000005476";
    const v4 = "0xd910000000000000000000000000000000046a1";
    const created = "0x4cbfe2c65e50098dd872d82c57b793bef0d538dc2d5b90e58400a0a4eb477422";
    const upgraded = "0xe68acbed8ebf0bcc3ef005410cc18e87e5d26c0c0667160ca3a1add2ccec1286";
    await db.insert(chainEvents).values([
      { chainId: arcTestnet.id, txHash: created, logIndex: 0, blockNumber: 66888083n, address: vault.toLowerCase(), eventName: "Upgraded", args: { implementation: v3 } },
      { chainId: arcTestnet.id, txHash: created, logIndex: 1, blockNumber: 66888083n, address: vault.toLowerCase(), eventName: "Initialized", args: { version: "1" } },
      { chainId: arcTestnet.id, txHash: upgraded, logIndex: 0, blockNumber: 67190741n, blockTime: new Date("2026-10-15T09:12:00Z"), address: vault.toLowerCase(), eventName: "Upgraded", args: { implementation: v4 } },
    ]);
    const now = await releaseTransactions(db, vault, v4 as `0x${string}`, false);
    expect(now.installedBy).toEqual({ kind: "upgraded", txHash: upgraded, at: "2026-10-15T09:12:00.000Z" });
    expect(now.scheduledTx).toBeNull();
    const before = await releaseTransactions(db, vault, v3 as `0x${string}`, false);
    expect(before.installedBy?.kind).toBe("created");
  });
});

describe("Activity: an owner's lending move is listed once", () => {
  const actor = { kind: "person", label: "Owner" } as unknown as ActivityItem["actor"];
  it("drops the prepared row the chain row carries, and an unsent retry of it", () => {
    const items: ActivityItem[] = [
      { id: "dec-a", at: "2026-10-15T17:18:40Z", actor, what: "Prepared the lending move", href: "/business/decisions/a", source: "decision" },
      { id: "dec-b", at: "2026-10-15T17:19:05Z", actor, what: "Prepared the lending move", href: "/business/decisions/b", source: "decision" },
      { id: "vev-0x48-3", at: "2026-10-15T17:19:30Z", actor, what: "Moved $91.00 into the lending vault", tx: "0x4802", source: "chain_event" },
    ];
    foldLendingMoves(
      items,
      [
        { itemId: "dec-a", hash: "0xaa", kind: "sweep", assets: "91000000", at: Date.parse("2026-10-15T17:18:40Z") },
        { itemId: "dec-b", hash: "0xbb", kind: "sweep", assets: "91000000", at: Date.parse("2026-10-15T17:19:05Z") },
      ],
      new Map([["0xbb", "vev-0x48-3"]]),
    );
    expect(items.map((i) => i.id)).toEqual(["vev-0x48-3"]);
    expect(items[0]!.href).toBe("/business/decisions/b");
  });
  it("uses the short wording", () => {
    expect(summarizeDecision({ kind: "sweep", inputs: { venue: "0x1", actor: "u1" }, outcome: "depositing" }).sentence).toBe("Prepared the lending move");
    expect(summarizeDecision({ kind: "redeem", inputs: { venue: "0x1", actor: "u1" }, outcome: "redeeming" }).sentence).toBe("Prepared the lending withdrawal");
  });
});

describe("Shortfall notices ring again only when the shortfall changes", () => {
  it("keys on the amount short and the first due date, not the day", () => {
    const due = BigInt(Date.parse("2026-10-27T00:00:00Z") / 1000);
    const a = shortfallDedupeKey("biz", "USDC", 572_393_201n, due);
    expect(a).toBe("shortfall:biz:USDC:572393201:2026-10-27");
    expect(shortfallDedupeKey("biz", "USDC", 572_393_201n, due + 3600n)).toBe(a);
    expect(shortfallDedupeKey("biz", "USDC", 480_000_000n, due)).not.toBe(a);
    expect(shortfallDedupeKey("biz", "EURC", 572_393_201n, due)).not.toBe(a);
  });
});

describe("Ask: money in an old answer is shown at two decimals", () => {
  it("rounds marked money only", () => {
    expect(tidyMoneyInText("Your operating cash of $510.386 covers the next bill.")).toBe("Your operating cash of $510.39 covers the next bill.");
    expect(tidyMoneyInText("It holds 457.456799 USDC and €1,204.5 EURC.")).toBe("It holds 457.46 USDC and €1,204.5 EURC.");
    expect(tidyMoneyInText("Fee 1.8% on 15.10.2026, block 67375403, $12.50.")).toBe("Fee 1.8% on 15.10.2026, block 67375403, $12.50.");
  });
});

describe("Steward page: internal keys are never shown", () => {
  it("leaves a settings subject unlabelled and words other keys", async () => {
    const b = await business();
    const refs = await subjectRefs(db, b.id, ["settings:early_pay", "settings:buffer"]);
    expect(refs.get("settings:early_pay")).toBeUndefined();
    expect(refs.get("settings:buffer")).toBeUndefined();
    expect(internalKeyLabel("vault:0xb8a6ce5ac6d25efd0822e431585bbee8eec3a46a:upgrade")).toBe("Vault upgrade");
  });
});
