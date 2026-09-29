"use client";

import { useState } from "react";

/** A link shown in full, with a button to copy it */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-5">
      <p className="break-all rounded-doc border border-rule bg-paper-raised p-3 font-mono text-xs">{link}</p>
      <button
        onClick={() => void navigator.clipboard?.writeText(link).then(() => setCopied(true))}
        className="mt-3 rounded-doc bg-ink px-4 py-2 text-sm font-medium text-paper"
      >
        {copied ? "Copied" : "Copy the link"}
      </button>
    </div>
  );
}
