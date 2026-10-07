import type { ReactNode } from "react";

const WIDTHS = {
  /** Forms and reading: profile, settings, notifications, Ask */
  narrow: "max-w-[760px]",
  /** Lists and detail pages */
  default: "max-w-[1080px]",
  /** Tables and charts that need the room */
  wide: "max-w-[1180px]",
} as const;

/**
 * The frame of a signed-in page's content. The shell already pads and centres the page, so this only sets how wide the content
 * may grow; it never centres or pads, which keeps every page's left edge on the same line as the header's.
 */
export function PageContainer({ width = "default", className = "", children }: { width?: keyof typeof WIDTHS; className?: string; children: ReactNode }) {
  return <div className={`w-full ${WIDTHS[width]} ${className}`}>{children}</div>;
}
