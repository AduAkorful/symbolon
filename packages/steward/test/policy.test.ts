import { describe, expect, it } from "vitest";

import { ApprovalLevel, checkPayment, effectivePayout, Risk } from "../src/index.js";
import { DAY, facts, NOW, payee, sealed, USDC, ZERO32 } from "./fixtures.js";

const rules = (r: ReturnType<typeof checkPayment>) => r.failures.map((f) => f.rule);

describe("policy mirror", async () => {
  const { invoice } = await sealed();
  const intent = (paid = invoice.amount, approvalHeld: 0 | 1 | 2 = ApprovalLevel.None) => ({ invoice, credit: invoice.amount, paid, maxFee: 0n, approvalHeld });

  it("passes a clean payment under the auto-pay limit", () => {
    const r = checkPayment(facts(), intent());
    expect(r).toMatchObject({ ok: true, failures: [], requiredApproval: ApprovalLevel.None, budgetId: ZERO32, outflow: 4_000n * USDC });
  });

  it("collects every failure, in the Vault's order", () => {
    const r = checkPayment(
      facts({ paused: true, isSupportedToken: () => false, payee: payee({ risk: Risk.Blocked, activeAt: NOW + DAY }) }),
      intent(),
    );
    expect(rules(r)).toEqual(["VaultPaused", "UnsupportedToken", "PayeeNotActive", "PayeeBlocked"]);
  });

  it("refuses a payout the payee record doesn't confirm, but honours a matured change", () => {
    const other = "0x0000000000000000000000000000000000000abc";
    expect(rules(checkPayment(facts({ payee: payee({ payout: other }) }), intent()))).toContain("PayoutMismatch");
    const p = payee({ payout: other, pendingPayout: invoice.payoutAddress, pendingDomain: 26, pendingActiveAt: NOW - 1n });
    expect(effectivePayout(p, NOW).payout).toBe(invoice.payoutAddress);
    expect(checkPayment(facts({ payee: p }), intent()).ok).toBe(true);
    const cooling = { ...p, pendingActiveAt: NOW + 1n };
    expect(rules(checkPayment(facts({ payee: cooling }), intent()))).toContain("PayoutMismatch");
  });

  it("requires approvals by amount and vendor history", () => {
    expect(checkPayment(facts(), intent(6_000n * USDC)).requiredApproval).toBe(ApprovalLevel.Approver);
    expect(checkPayment(facts(), intent(11_000n * USDC)).requiredApproval).toBe(ApprovalLevel.Owner);
    expect(rules(checkPayment(facts(), intent(6_000n * USDC)))).toEqual(["ApprovalRequired"]);
    expect(checkPayment(facts(), intent(6_000n * USDC, ApprovalLevel.Approver)).ok).toBe(true);
    const newVendor = facts({ policy: { ...facts().policy, newVendorMinPaid: 10 } });
    expect(checkPayment(newVendor, intent()).requiredApproval).toBe(ApprovalLevel.Approver);
    expect(checkPayment(facts({ payee: payee({ risk: Risk.High }) }), intent()).requiredApproval).toBe(ApprovalLevel.Owner);
  });

  it("enforces caps with period rollover", () => {
    expect(rules(checkPayment(facts({ payee: payee({ spentInPeriod: 99_000n * USDC }) }), intent()))).toContain("PayeeCapExceeded");
    // last period's spend doesn't count
    const stale = payee({ spentInPeriod: 99_000n * USDC, spendPeriod: NOW / (30n * DAY) - 1n });
    expect(checkPayment(facts({ payee: stale }), intent()).ok).toBe(true);
    expect(rules(checkPayment(facts({}, { spent: 999_000n * USDC }), intent()))).toContain("BudgetExceeded");
    expect(checkPayment(facts({}, { spent: 999_000n * USDC, periodIndex: 0n }), intent()).ok).toBe(true);
    expect(rules(checkPayment(facts(), intent(60_000n * USDC, ApprovalLevel.Owner)))).toContain("PerTxCapExceeded");
  });

  it("uses the PO's budget and checks it like the Vault", async () => {
    const po = { open: true, seal: invoice.seal, releaseAfter: 0n, budget: `0x${"01".repeat(32)}` as const, remaining: 10_000n * USDC };
    const withPo = await sealed({ poNumber: "PO-1" });
    const r = checkPayment(facts({ purchaseOrder: po }), { ...intent(), invoice: withPo.invoice });
    expect(rules(r)).toEqual(["UnknownBudget"]);
    expect(r.budgetId).toBe(po.budget);
    const small = { ...po, budget: ZERO32, remaining: 1n };
    expect(rules(checkPayment(facts({ purchaseOrder: small }), { ...intent(), invoice: withPo.invoice }))).toEqual(["PurchaseOrderExceeded"]);
    const requirePo = payee({ terms: { ...payee().terms, requirePo: true } });
    expect(rules(checkPayment(facts({ payee: requirePo }), intent()))).toContain("PurchaseOrderRequired");
  });

  it("requires delivery when the payee's terms say so", () => {
    const threeWay = payee({ terms: { ...payee().terms, requireDelivery: true } });
    expect(rules(checkPayment(facts({ payee: threeWay }), intent()))).toEqual(["DeliveryNotConfirmed"]);
    expect(checkPayment(facts({ payee: threeWay, deliveryConfirmed: true }), intent()).ok).toBe(true);
  });

  it("refuses unknown payees and stale screening", () => {
    expect(rules(checkPayment(facts({ payee: undefined }), intent()))).toEqual(["UnknownPayee"]);
    const strict = facts({ policy: { ...facts().policy, screeningMaxAge: 3_600n } });
    expect(rules(checkPayment(strict, intent()))).toContain("ScreeningStale");
  });
});

describe("cross-chain payouts", async () => {
  const remote = await sealed({ payout: { address: "0x530df8c969be62acbdc58aa33bc40027b66007d0", domain: 6 } });
  const intent = { invoice: remote.invoice, credit: remote.invoice.amount, paid: remote.invoice.amount, maxFee: 0n, approvalHeld: ApprovalLevel.None };
  const p = payee({ payoutDomain: 6 });

  it("explains in advance that CCTP can't carry a token (EURC from Arc) instead of letting the payment revert", () => {
    const r = checkPayment(facts({ payee: p, localDomain: 26, cctpBurnLimit: () => 0n }), intent);
    expect(r.failures.map((f) => f.rule)).toEqual(["CrossChainTokenUnsupported"]);
    expect(checkPayment(facts({ payee: p, localDomain: 26, cctpBurnLimit: () => 10n ** 13n }), intent).ok).toBe(true);
    expect(checkPayment(facts({ payee: p, localDomain: 26, cctpBurnLimit: () => 1n }), intent).failures[0]!.rule).toBe("CrossChainAmountTooLarge");
  });
});
