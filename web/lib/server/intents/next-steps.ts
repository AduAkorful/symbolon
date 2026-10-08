import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { erc20Abi, getAddress } from "viem";
import { businesses, invoices, payees } from "@symbolon/db";
import { readVaultState, stewardStanding } from "../vault-read";
import type { IntentAnswer, IntentContext, IntentHandler } from "./types";

// Plan 05ze. "What should I do next?" is built from state the app already reads, in a fixed order, so the advice is never the
// model's invention; the model only chooses this lookup and, afterwards, words the reply. Each step is one sentence with a link.

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const nextStepsIntent: IntentHandler = {
  descriptor: {
    name: "next_steps",
    description: "What the owner should do next: setup left to finish, funding, a paused Steward, invoices waiting for approval, held invoices, vendors waiting to be verified",
    params: {},
  },
  async execute(ctx: IntentContext): Promise<IntentAnswer> {
    const [biz] = await ctx.db.select().from(businesses).where(eq(businesses.id, ctx.businessId)).limit(1);
    const steps: { text: string; link: [string, string] }[] = [];
    const unread: string[] = [];

    if (!biz?.vault) {
      steps.push({ text: "Finish setting up your Vault: it holds the money invoices are paid from.", link: ["Set up", "/business"] });
    } else {
      const vault = getAddress(biz.vault);
      const [state, usdc, eurc] = await Promise.all([
        readVaultState(ctx.client, ctx.deployment, biz.vault).catch(() => null),
        ctx.client.readContract({ address: ctx.deployment.tokens.usdc, abi: erc20Abi, functionName: "balanceOf", args: [vault] }).catch(() => null),
        ctx.client.readContract({ address: ctx.deployment.tokens.eurc, abi: erc20Abi, functionName: "balanceOf", args: [vault] }).catch(() => null),
      ]);

      if (!state) unread.push("the Steward's standing");
      else {
        const standing = stewardStanding(biz.stewardWallet, state);
        if (standing.kind === "paused") steps.push({ text: "The Vault is paused, so nothing will be paid. Resume it when you are ready for payments to go out.", link: ["Steward", "/business/steward"] });
        else if (standing.kind === "mismatch" || standing.kind === "none") steps.push({ text: "The Steward on the Vault isn't the one recorded for this business. Check it before anything is paid.", link: ["Steward", "/business/steward"] });
        else if (standing.kind === "unknown") unread.push("the Steward's standing");
      }

      if (usdc === null || eurc === null) unread.push("the Vault's balance");
      else if (usdc === 0n && eurc === 0n) steps.push({ text: "The Vault is empty. Add USDC so invoices can be paid.", link: ["Treasury", "/business/treasury"] });
    }

    const counts = await ctx.db
      .select({ status: invoices.status, n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.businessId, ctx.businessId), inArray(invoices.status, ["awaiting_approval", "held"])))
      .groupBy(invoices.status);
    const count = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;
    if (count("awaiting_approval") > 0) steps.push({ text: `${plural(count("awaiting_approval"), "invoice is", "invoices are")} waiting for your approval.`, link: ["Approvals", "/business/approvals"] });
    if (count("held") > 0) steps.push({ text: `${plural(count("held"), "invoice is", "invoices are")} on hold. Open them to see why.`, link: ["Inbox", "/business/inbox"] });

    const [waiting] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(payees)
      .where(and(eq(payees.businessId, ctx.businessId), eq(payees.status, "pending_verification")));
    if ((waiting?.n ?? 0) > 0) steps.push({ text: `${plural(waiting!.n, "vendor is", "vendors are")} waiting to be verified before they can be paid.`, link: ["Vendors", "/business/vendors"] });

    const shown = steps.slice(0, 4);
    const text = [
      shown.length === 0 ? "Nothing needs you right now." : `Here is what needs you, most important first:\n${shown.map((s, i) => `${i + 1}. ${s.text}`).join("\n")}`,
      unread.length > 0 ? `I couldn't read ${unread.join(" or ")} just now, so that isn't covered.` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { text, links: shown.map((s) => s.link), source: "From: your invoices, vendors and the Vault, just now", intent: "next_steps" };
  },
};
