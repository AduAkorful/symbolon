"use client";

import { useState } from "react";

/** Copies a value and says so; if the browser refuses, it says that instead of pretending */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        navigator.clipboard.writeText(value).then(
          () => setState("copied"),
          () => setState("failed"),
        );
        setTimeout(() => setState("idle"), 1800);
      }}
      className="ml-2 inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-doc px-2 py-1 text-xs text-graphite hover:text-ink pointer-coarse:min-h-11 pointer-coarse:min-w-11"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}
