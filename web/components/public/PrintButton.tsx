"use client";

/** Opens the browser's print dialog, where "Save as PDF" is one of the choices */
export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="rounded-doc border border-rule px-4 py-2.5 text-sm hover:border-ink print:hidden">
      Print or save as PDF
    </button>
  );
}
