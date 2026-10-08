"use client";

import { buttonClass } from "@/components/ui/button";

/** Opens the browser's print dialog, where "Save as PDF" is one of the choices */
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className={buttonClass({ variant: "secondary" })}>
      Print or save as PDF
    </button>
  );
}
