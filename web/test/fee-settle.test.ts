import { describe, expect, it } from "vitest";
import { settleFee, type FeeView } from "../components/steward/fee-settle";

const fee = (raw: string | null): FeeView => ({ formatted: raw ?? "can't confirm", raw });
const noWait = async () => {};

describe("settling the Steward fee balance after a top-up", () => {
  it("keeps reading until the balance differs, then shows it", async () => {
    const answers = [fee("1000"), fee("1000"), fee("101000")];
    const shown: FeeView[] = [];
    const out = await settleFee({ before: "1000", read: async () => answers.shift() ?? null, show: (f) => shown.push(f), sleep: noWait });
    expect(out).toBe("changed");
    expect(shown).toEqual([fee("101000")]);
  });

  it("skips reads that failed and goes on", async () => {
    const answers = [null, fee(null), fee("5")];
    const out = await settleFee({ before: "1", read: async () => answers.shift() ?? null, show: () => {}, sleep: noWait });
    expect(out).toBe("changed");
  });

  it("gives up and says unchanged when the balance never moves, showing nothing new", async () => {
    let reads = 0;
    const shown: FeeView[] = [];
    const out = await settleFee({ before: "7", read: async () => (reads++, fee("7")), show: (f) => shown.push(f), tries: 4, sleep: noWait });
    expect(out).toBe("unchanged");
    expect(reads).toBe(4);
    expect(shown).toEqual([]);
  });
});
