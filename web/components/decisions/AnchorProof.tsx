import { TxLink } from "@/components/TxLink";
import type { DecisionAnchorInfo } from "@/lib/server/anchoring";
import { formatDateTime } from "@/lib/format";

interface Props {
  anchor: DecisionAnchorInfo;
  explorerUrl: string;
}

export function AnchorProof({ anchor, explorerUrl }: Props) {
  if (anchor.status !== "anchored") {
    return (
      <div className="rounded-doc border border-rule-soft bg-paper-raised p-5 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-graphite" />
          <span className="font-mono text-xs uppercase tracking-wider text-graphite">
            Anchoring status: {anchor.status === "unconfirmed" ? "Unconfirmed" : "Pending"}
          </span>
        </div>
        <p className="mt-2 text-graphite text-xs">
          {anchor.reason ?? "Not anchored onchain yet. Pending decision hashes are batched into a Merkle root and anchored to the Vault by the Steward."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-doc border border-rule bg-paper-raised p-5 text-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${anchor.proofValid ? "bg-seal" : "bg-red"}`} />
          <span className="font-mono text-xs uppercase tracking-wider text-ink font-medium">
            Anchored onchain
          </span>
        </div>
        {anchor.proofValid ? (
          <span className="rounded bg-seal/10 px-2 py-0.5 font-mono text-xs text-seal">
            Merkle proof verified ✓
          </span>
        ) : (
          <span className="rounded bg-red/10 px-2 py-0.5 font-mono text-xs text-red">
            Proof verification failed ✕
          </span>
        )}
      </div>

      <dl className="grid gap-2 border-t border-rule-soft pt-3 text-xs sm:grid-cols-[9rem_1fr]">
        <dt className="text-graphite">Merkle root</dt>
        <dd className="font-mono break-all text-ink">{anchor.root}</dd>

        <dt className="text-graphite">Batch size</dt>
        <dd className="font-mono text-ink">{anchor.count} decisions</dd>

        {anchor.blockTime ? (
          <>
            <dt className="text-graphite">Anchored at</dt>
            <dd className="text-ink">{formatDateTime(new Date(anchor.blockTime))}</dd>
          </>
        ) : null}

        {anchor.txHash ? (
          <>
            <dt className="text-graphite">Transaction</dt>
            <dd className="font-mono">
              <TxLink
                href={`${explorerUrl}/tx/${anchor.txHash}`}
                label="View anchoring transaction on Arc"
                className="underline text-graphite hover:text-ink break-all"
              >
                {anchor.txHash}
              </TxLink>
            </dd>
          </>
        ) : null}
      </dl>

      {anchor.proof && anchor.proof.length > 0 ? (
        <details className="text-xs text-graphite">
          <summary className="cursor-pointer hover:text-ink select-none font-medium">
            Show Merkle audit proof ({anchor.proof.length} sibling hashes)
          </summary>
          <div className="mt-2 space-y-1 rounded bg-paper p-3 font-mono text-[11px] overflow-x-auto">
            {anchor.proof.map((sibling, i) => (
              <div key={i} className="text-graphite">
                [{i}]: {sibling}
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
