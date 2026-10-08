"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A link shown in full, with a button to copy it */
export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-5">
      <p className="break-all rounded-doc border border-rule bg-paper-raised px-4 py-3 font-mono text-sm">{link}</p>
      <Button
        className="mt-3"
        onClick={() => void navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      >
        {copied ? "Copied" : "Copy the link"}
      </Button>
    </div>
  );
}
