"use client";

import { useState, type ReactNode } from "react";
import { EXPLORER } from "@/lib/tx";

/**
 * An onchain reference that opens the Arc explorer: `tx` for a transaction, `address` for a contract or wallet.
 * The prototype's references are demo values, so a click explains where the real link goes instead of opening a
 * page that doesn't exist.
 */
export function TxLink({ hash, kind = "tx", children, className = "" }: { hash: string; kind?: "tx" | "address"; children?: ReactNode; className?: string }) {
  const [note, setNote] = useState(false);
  const noun = kind === "tx" ? "transaction" : "address";
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <a
        href={`${EXPLORER}/${kind}/${hash}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`View ${noun} ${hash} on the Arc explorer`}
        onClick={(e) => {
          e.preventDefault();
          setNote((n) => !n);
        }}
        className="font-mono text-xs underline decoration-rule underline-offset-4 hover:decoration-ink"
      >
        {children ?? hash}
        <span aria-hidden> ↗</span>
      </a>
      {note ? (
        <span role="status" className="text-xs text-graphite">
          Demo reference. In the app this opens the {noun} on {EXPLORER.replace("https://", "")}.
        </span>
      ) : null}
    </span>
  );
}
