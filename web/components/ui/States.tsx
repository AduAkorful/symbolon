import type { ReactNode } from "react";

import { SmallTitle } from "./Type";

/**
 * Nothing here yet (plan 05zb S11). Says what is missing and, when there is one, what to do next. One look for every list
 * and table that can be empty.
 */
export function EmptyState({ title, children, action, className = "" }: { title: string; children?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-doc border border-dashed border-rule px-6 py-10 text-center ${className}`}>
      <SmallTitle>{title}</SmallTitle>
      {children ? <p className="mx-auto mt-1.5 max-w-[48ch] text-sm text-graphite">{children}</p> : null}
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

/** Something is being read: one line, one look */
export function InlineLoading({ children = "Loading…", className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <p role="status" className={`flex items-center gap-2 text-sm text-graphite ${className}`}>
      <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-rule border-t-graphite" />
      {children}
    </p>
  );
}

/** Something failed: says what, in red, and is announced to screen readers */
export function InlineError({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`rounded-doc border border-red/40 bg-red-wash px-3 py-2 text-sm text-red ${className}`}>
      {children}
    </p>
  );
}
