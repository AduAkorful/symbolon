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
      className="ml-2 rounded px-1.5 py-0.5 text-[10px] text-graphite hover:text-ink"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
}
