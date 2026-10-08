import type { Metadata } from "next";
import { arcChain } from "@symbolon/chain";
import { PublicHeader } from "@/components/public/PublicHeader";
import { Verify } from "@/components/public/Verify";
import { getConfig } from "@/lib/server/config";
import { CONTAINER } from "@/components/shell/container";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verify an invoice" };

/** Is this invoice genuine, and has it been paid? Anyone can ask. The check itself runs in their browser. */
export default function VerifyPage() {
  const { chainId } = getConfig();
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className={`${CONTAINER} pb-24 pt-14`}>
        <h1 className="max-w-[18ch] font-display text-[clamp(2.4rem,5vw,4rem)] leading-[1.02]">Is this invoice genuine, and has it been paid?</h1>
        <p className="mt-4 max-w-[62ch] text-graphite">Drop an invoice file or paste its link. The check runs in your browser against the public ledger on Arc. Nothing is uploaded.</p>
        <div className="mt-10">
          <Verify chainId={chainId} explorer={arcChain(chainId).blockExplorers!.default.url} />
        </div>
      </main>
    </div>
  );
}
