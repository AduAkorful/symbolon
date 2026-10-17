import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Half } from "@/components/Chirograph";
import { shortHex } from "@/lib/format";
import { dropLendingReturnDeposits, type ActivityItem } from "@/lib/server/activity";
import { checkReply } from "@/lib/server/ask-check";
import { isLendingReturn, summarizeDecision } from "@/lib/server/decision-text";
import { foldRecentDecisions, type LendingEvent } from "@/lib/server/steward-decisions";

// QA Retest 18 (17 Oct): the Steward page's lending rows and stale blocker, the copy buttons, the invoice card's letters, Ask

const VENUE = "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88"; // EarnKit USDC Vault
const USDC = "0x3600000000000000000000000000000000000000";
const EURC = "0x89b50855aa3be2f677cd6303cec089b5f319d72a";
const REDEEM_TX = "0xfeeaee1aaafbb216c5ed8026be6fe34f0b805350588cd15ba476e86c5286d659";
const DEPOSIT_TX = "0x4802730f22000000000000000000000000000000000000000000000000000000";

type Row = Parameters<typeof foldRecentDecisions>[0][number];
let seq = 0;
function row(kind: string, at: string, record: Record<string, unknown>, extra: Partial<Row> = {}): Row {
  seq += 1;
  return { id: `d${seq}`, businessId: "b", kind, subject: null, record: { kind, at, ...record }, hash: `0x${seq.toString(16).padStart(64, "0")}`, txHash: null, createdAt: new Date(at), ...extra } as unknown as Row;
}

describe("Steward page: Recent decisions tell each lending move once", () => {
  const prepA = row("sweep", "2026-10-15T17:18:40Z", { inputs: { venue: VENUE, actor: "owner-1", assets: "91000000" }, outcome: "depositing" });
  const prepB = row("sweep", "2026-10-15T17:19:05Z", { inputs: { venue: VENUE, actor: "owner-1", assets: "91000000" }, outcome: "depositing" });
  const back = row(
    "deposit_confirmed",
    "2026-10-15T17:27:10Z",
    { inputs: { txHash: REDEEM_TX, token: "USDC", amount: "90999999", from: "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88", actor: "chain" }, outcome: "deposited" },
    { txHash: REDEEM_TX as `0x${string}` },
  );
  const lending: LendingEvent[] = [
    { eventName: "LendingDeposited", txHash: DEPOSIT_TX, decisionHash: prepB.hash, assets: "91000000" },
    { eventName: "LendingRedeemed", txHash: REDEEM_TX, decisionHash: "0x" + "ee".repeat(32), assets: "90999999" },
  ];

  it("keeps the sent move, words it as the move, and drops the retried prepare", () => {
    const out = foldRecentDecisions([back, prepB, prepA], lending, { lendingVenues: new Set([VENUE]) });
    expect(out.map((d) => [d.summary.sentence, d.kindLabel, d.txHash])).toEqual([
      ["Took $91.00 back from the lending vault", "Lending", REDEEM_TX],
      ["Moved $91.00 into the lending vault", "Lending", DEPOSIT_TX],
    ]);
  });

  it("knows cash back from lending by its redeem transaction even without the venue list", () => {
    const out = foldRecentDecisions([back], lending);
    expect(out[0]!.summary.sentence).toBe("Took $91.00 back from the lending vault");
  });

  it("lists the Steward's own redeem once, with why, when its decision carries the transaction", () => {
    const stewardRedeem = row("redeem", "2026-10-15T17:27:00Z", { inputs: { venue: VENUE, all: true }, outcome: "redeeming" });
    const events: LendingEvent[] = [{ eventName: "LendingRedeemed", txHash: REDEEM_TX, decisionHash: stewardRedeem.hash, assets: "90999999" }];
    const out = foldRecentDecisions([back, stewardRedeem], events, { lendingVenues: new Set([VENUE]) });
    expect(out.map((d) => d.summary.sentence)).toEqual(["Took $91.00 back from the lending vault ahead of upcoming bills"]);
    expect(out[0]!.txHash).toBe(REDEEM_TX);
  });

  it("keeps one unsent prepare when nothing was sent", () => {
    const out = foldRecentDecisions([prepB, prepA], []);
    expect(out.map((d) => d.summary.sentence)).toEqual(["Prepared the lending move"]);
  });

  it("leaves a real deposit as a deposit", () => {
    const dep = row("deposit_confirmed", "2026-10-14T09:00:00Z", { inputs: { txHash: "0x" + "12".repeat(32), token: "USDC", amount: "250000000", from: "0x645c000000000000000000000000000000004e7b" } });
    expect(foldRecentDecisions([dep], lending, { lendingVenues: new Set([VENUE]) })[0]!.summary.sentence).toBe("Added $250.00 to the Vault");
    expect(isLendingReturn(dep.record as Record<string, unknown>, new Set([VENUE]))).toBe(false);
  });

  it("words a deposit record marked as coming back from lending", () => {
    expect(summarizeDecision({ kind: "deposit_confirmed", inputs: { token: "USDC", amount: "90999999", fromLending: true } }).sentence).toBe("Took $91.00 back from the lending vault");
  });
});

describe("Activity: cash back from lending is not listed again as a deposit", () => {
  it("drops the deposit row whose transaction is a redeem", () => {
    const actor = { kind: "system", label: "Read from Arc" } as unknown as ActivityItem["actor"];
    const items: ActivityItem[] = [
      { id: "dec-x", at: "2026-10-15T17:27:10Z", actor, what: "Added $91.00 to the Vault", tx: REDEEM_TX, source: "decision" },
      { id: `vev-${REDEEM_TX}-0`, at: "2026-10-15T17:27:10Z", actor, what: "Took $91.00 out of the lending vault", tx: REDEEM_TX, source: "chain_event" },
      { id: "dec-y", at: "2026-10-14T09:00:00Z", actor, what: "Added $250.00 to the Vault", tx: "0x" + "12".repeat(32), source: "decision" },
    ];
    dropLendingReturnDeposits(items, new Map([["dec-x", REDEEM_TX], ["dec-y", "0x" + "12".repeat(32)]]), new Set([REDEEM_TX]));
    expect(items.map((i) => i.id)).toEqual([`vev-${REDEEM_TX}-0`, "dec-y"]);
  });
});

describe("A scheduled decision's blockers are said as of their time", () => {
  const unsupported = { rule: "UnsupportedToken", detail: `${USDC} isn't a payment token of this Vault` };
  const overCap = { rule: "PerTxCapExceeded", detail: "780000000 over the per-payment cap 640000000" };
  const rec = (blockers: { rule: string; detail: string }[]) => ({ kind: "schedule", at: "2026-10-15T17:07:12Z", inputs: { blockers }, outcome: "scheduled for 2026-10-27T00:00:00Z" });

  it("labels them with the decision's time instead of 'today'", () => {
    expect(summarizeDecision(rec([overCap])).sentence).toBe("Scheduled for the due date. In the way when checked (15 Oct, 17:07 UTC): Over the per-payment limit");
  });

  it("says a currency the Vault pays in now has cleared since", () => {
    expect(summarizeDecision(rec([unsupported]), { supportedTokens: new Set([USDC]) }).sentence).toBe(
      "Scheduled for payment on the due date. Cleared since 15 Oct, 17:07 UTC: The Vault doesn't accept this currency",
    );
    expect(summarizeDecision(rec([unsupported, overCap]), { supportedTokens: new Set([USDC]) }).sentence).toBe(
      "Scheduled for the due date. In the way when checked (15 Oct, 17:07 UTC): Over the per-payment limit. Cleared since: The Vault doesn't accept this currency",
    );
  });

  it("keeps a currency blocker the Vault still has, and one it couldn't check", () => {
    const eurc = { rule: "UnsupportedToken", detail: `${EURC} isn't a payment token of this Vault` };
    expect(summarizeDecision(rec([eurc]), { supportedTokens: new Set([USDC]) }).sentence).toContain("In the way when checked (15 Oct, 17:07 UTC): The Vault doesn't accept this currency");
    expect(summarizeDecision(rec([unsupported])).sentence).toContain("In the way when checked (15 Oct, 17:07 UTC): The Vault doesn't accept this currency");
  });
});

describe("Short hex values with Copy", () => {
  it("shortens a change ID like an address", () => {
    expect(shortHex("0x9145b3aa00000000000000000000000000000000000000000000000000fd449e")).toBe("0x9145…449e");
    expect(shortHex("0xc81fe21103bb5d1fd1d2344b78deb53495041cfb")).toBe("0xc81f…1CFb");
    expect(shortHex("not hex")).toBe("not hex");
  });
});

describe("Invoice card: the fingerprint letters stay inside the card", () => {
  const fp = "0x17b80500000000000000000000000000000000000000000000000000047e202";
  it("puts the letters inside the cut when the half is shown alone", () => {
    const html = renderToStaticMarkup(createElement(Half, { side: "vendor", fingerprint: fp, lettersInside: true, children: createElement("p", null, "x") }));
    expect(html).toMatch(/data-seam="letters"[^>]*style="right:26px"/);
    expect(html).not.toContain("translateX(50%)");
  });
  it("keeps them across the cut on the landing pair", () => {
    const html = renderToStaticMarkup(createElement(Half, { side: "vendor", fingerprint: fp, children: createElement("p", null, "x") }));
    expect(html).toContain("translateX(50%)");
  });
});

describe("Ask: a reply may not say it can't see a balance the facts give", () => {
  const facts = ["The Vault's balance is $510.39 and €0.00, all of it operating cash. Reserve holds 0 USYC."];
  it("rejects the old wording", () => {
    const r = checkReply("I can see operating cash of $510.39 in USDC. I can't see the Vault's balance.", { facts, question: "What's my balance?" });
    expect(r).toEqual({ ok: false, reason: "says it can't see a balance the facts give" });
    expect(checkReply("I’m unable to see your cash right now.", { facts, question: "cash?" }).ok).toBe(false);
  });
  it("allows a plain answer, and a denial when the facts give no money", () => {
    expect(checkReply("The Vault's balance is $510.39, all of it operating cash.", { facts, question: "What's my balance?" }).ok).toBe(true);
    expect(checkReply("I can't see the Vault's balance right now.", { facts: ["Can't confirm the Vault balances right now. Try again shortly."], question: "balance?" }).ok).toBe(true);
  });
});
