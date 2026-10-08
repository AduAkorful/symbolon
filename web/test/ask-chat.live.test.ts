// Plan 05ze: does the real model hold a conversation that survives our own checker? Calls OpenRouter for real (a few cents).
//   LIVE=1 OPENROUTER_API_KEY=… pnpm --filter @symbolon/app exec vitest run test/ask-chat.live.test.ts
// Each turn: what the person was shown, and whether it was the model's wording (accepted by checkReply) or the lookups' own text
// (the reply was rejected). A rejected reply is a safe miss; the score is how often the conversation feels like one.
import { appendFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const out = (line: string) => { console.log(line); if (process.env.CHAT_LOG) appendFileSync(process.env.CHAT_LOG, line + "\n"); };

vi.mock("server-only", () => ({}));
const modelState = vi.hoisted(() => ({ current: null as import("@symbolon/steward").StewardModel | null }));
vi.mock("@/lib/server/steward-model", () => ({ getStewardModel: () => modelState.current }));
import { arcTestnet, getDeployment } from "@symbolon/chain";
import { businesses, createTestDb, invoices, members, users } from "@symbolon/db";
import { OpenRouterStewardModel } from "@symbolon/steward";
import { askSteward } from "@/lib/server/ask";
import { checkReply } from "@/lib/server/ask-check";

const key = process.env.OPENROUTER_API_KEY?.trim();
const live = Boolean(process.env.LIVE && key);

const scripts: { name: string; turns: string[] }[] = [
  { name: "the operator's own conversation", turns: ["What are we paying this week?", "do I have any funds?", "what do you think my next steps should be", "I have none"] },
  { name: "small talk and capabilities", turns: ["hi", "what can you do?", "can you pay the invoice for me?", "thanks"] },
  { name: "follow-ups", turns: ["anything due in the next month?", "why is that?", "and what about held invoices?"] },
];

describe.skipIf(!live)("Ask as a conversation with the real model (plan 05ze)", () => {
  it("answers in conversation, with every reply checked", { timeout: 300_000 }, async () => {
    process.env.CHAIN_ID = "5042002";
    modelState.current = new OpenRouterStewardModel({ apiKey: key!, model: process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-6-luna", zdr: true, log: () => {} });
    const db = await createTestDb();
    const [u] = await db.insert(users).values({ email: "owner@acme.example" }).returning();
    const [b] = await db.insert(businesses).values({ name: "Acme Corp", chainId: 5042002 }).returning();
    await db.insert(members).values({ businessId: b!.id, userId: u!.id, role: "owner" });
    const d = getDeployment(arcTestnet.id);
    await db.insert(invoices).values({ fingerprint: `0x${"11".repeat(32)}`, chainId: 5042002, ledger: d.contracts.invoiceLedger, seal: `0x${"ab".repeat(20)}`, businessId: b!.id, payerRef: `0x${"00".repeat(32)}`, invoiceNumber: "INV-001", token: d.tokens.usdc, total: 10_000_000n, credited: 0n, dueDate: new Date(Date.now() + 20 * 86_400_000), envelope: "{}", source: "link" });

    let phrased = 0;
    let total = 0;
    for (const script of scripts) {
      const log: { question: string; intent: string; params: Record<string, unknown>; reply: string }[] = [];
      out(`\n── ${script.name}`);
      for (const q of script.turns) {
        const res = await askSteward({ db, businessId: b!.id, userId: u!.id, question: q, history: log.slice(-6) });
        const own = res.facts !== undefined || (res.intent === "conversation" && !res.text.startsWith("I can look up") && !res.text.startsWith("I couldn't reach"));
        total++;
        if (own) phrased++;
        out(`  you: ${q}\n  ${own ? "model" : "lookup"}: ${res.text.replace(/\n/g, " ⏎ ")}  [${res.intent}]`);
        // whatever was shown must itself hold up
        if (own) expect(checkReply(res.text, { facts: (res.facts ?? []).flatMap((f) => [f.text, f.source]), question: q }).ok).toBe(true);
        log.push({ question: q, intent: res.intent, params: res.params, reply: res.text });
      }
    }
    out(`\nmodel wording shown on ${phrased} of ${total} turns`);
    expect(phrased / total).toBeGreaterThan(0.6);
  });
});
