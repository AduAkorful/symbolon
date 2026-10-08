import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { arcChain } from "@symbolon/chain";

import { ReceiptView } from "@/components/receipt/ReceiptView";
import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { loadReceipt } from "@/lib/server/receipt";
import { PageTitle } from "@/components/ui/Type";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment Receipt · Symbolon",
  robots: {
    index: false,
    follow: false,
  },
};

interface Props {
  params: Promise<{ fingerprint: string }>;
}

export default async function ReceiptPage({ params }: Props) {
  const { fingerprint } = await params;
  const db = await getDb();
  const client = getClient();
  const config = getConfig();

  const data = await loadReceipt(db, client, config, fingerprint);
  if (!data) return notFound();

  const explorerUrl = arcChain(config.chainId).blockExplorers!.default.url;

  if (data.state === "unconfirmed") {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-20 text-center">
        <PageTitle>Receipt unconfirmed</PageTitle>
        <p className="mt-3 text-sm text-graphite">{data.reason}</p>
      </main>
    );
  }

  return <ReceiptView data={data} explorerUrl={explorerUrl} />;
}
