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
      className="ml-2 shrink-0 whitespace-nowrap rounded-doc px-2 py-1 text-xs text-graphite hover:text-ink"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}
