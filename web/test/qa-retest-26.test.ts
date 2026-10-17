import { describe, expect, it } from "vitest";

import { tidyRawUnits } from "@/lib/format";
import { shortfallDedupeKey } from "@/lib/server/due-notices";
import { describeNotification } from "@/lib/server/notification-text";
import { usdcWords } from "@symbolon/steward";

// QA R26 (17 Oct, demo recording): notices on Telegram still showed raw units or 4–6 decimals

const at = new Date("2026-10-17T12:13:00.000Z");
const n = (kind: string, body: Record<string, unknown>) => describeNotification({ kind, subject: null, body, createdAt: at });

describe("R26-1: 'Cash taken back from lending' says the reason in money", () => {
  it("formats a stored reason that still carries raw units", () => {
    const v = n("lending_moved", { direction: "out", amount: "58200000", reason: "cash 234576799 is below the 1297500000 needed for the buffer and upcoming bills" });
    expect(v.body).toBe("The Steward took $58.20 back from the lending vault. Cash $234.58 is below the $1,297.50 needed for the buffer and upcoming bills.");
  });
  it("the Steward's own reason is already in money at source", () => {
    expect(usdcWords(1_297_500_000n)).toBe("1,297.50 USDC");
    expect(tidyRawUnits("cash 234.58 USDC is below")).toBe("cash 234.58 USDC is below");
  });
});

describe("R26-2: 'USDC may run short' rounds to the cent", () => {
  it.each(["572.393201 USDC", "572.3932 USDC"])("%s → $572.39", (short) => {
    expect(n("shortfall", { symbol: "USDC", short }).body).toContain("The Vault is $572.39 short of");
  });
});

describe("R26-3: a discounted payment is shown to the cent", () => {
  it("$94.2792 → $94.28", () => {
    const v = n("payment_sent", { invoiceNumber: "ACCS-2026-0005", vendorName: "Accra Cold Chain Supplies", amount: "94.279200 USDC" });
    expect(v.body).toBe("$94.28 was sent to Accra Cold Chain Supplies for invoice ACCS-2026-0005.");
  });
  it("Early Pay notice too", () => {
    expect(n("early_pay_accepted", { invoiceNumber: "X", amount: "94.2792 USDC", discountBps: 150 }).body).toContain("$94.28 sent");
  });
});

describe("R26-5: a shortfall that rounds to the same cent is one alert", () => {
  it("572.393201 and 572.3932 share a key; a cent's difference does not", () => {
    const due = BigInt(Date.parse("2026-10-27T00:00:00Z") / 1000);
    const a = shortfallDedupeKey("biz", "USDC", 572_393_201n, due);
    expect(shortfallDedupeKey("biz", "USDC", 572_393_200n, due)).toBe(a);
    expect(shortfallDedupeKey("biz", "USDC", 572_385_000n, due)).toBe(a);
    expect(shortfallDedupeKey("biz", "USDC", 572_403_201n, due)).not.toBe(a);
    expect(shortfallDedupeKey("biz", "USDC", 572_393_201n, due + 86_400n)).not.toBe(a);
  });
});
