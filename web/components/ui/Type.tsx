import type { ElementType, ReactNode } from "react";

/**
 * The type scale (plan 05zb S4). Four roles, one style each, so no screen picks its own sizes:
 * PageTitle (one per page), SectionTitle (a block of the page), SmallTitle (a card or a group inside a block), Eyebrow (the
 * small label above a title or beside a value). Sentence case in the words you pass; nothing here changes the case of a title.
 */
export function PageTitle({ children, className = "", as: Tag = "h1", id }: { children: ReactNode; className?: string; as?: ElementType; id?: string }) {
  return <Tag id={id} className={`font-display text-4xl leading-tight break-words text-ink md:text-5xl md:leading-[1.05] ${className}`}>{children}</Tag>;
}

export function SectionTitle({ children, className = "", as: Tag = "h2", id }: { children: ReactNode; className?: string; as?: ElementType; id?: string }) {
  return <Tag id={id} className={`font-display text-2xl leading-snug text-ink ${className}`}>{children}</Tag>;
}

export function SmallTitle({ children, className = "", as: Tag = "h3", id }: { children: ReactNode; className?: string; as?: ElementType; id?: string }) {
  return <Tag id={id} className={`text-base font-medium text-ink ${className}`}>{children}</Tag>;
}

export function Eyebrow({ children, className = "", as: Tag = "p", id }: { children: ReactNode; className?: string; as?: ElementType; id?: string }) {
  return <Tag id={id} className={`font-mono text-xs uppercase tracking-[0.16em] text-graphite ${className}`}>{children}</Tag>;
}

/** The sentence under a title that says what the page is for */
export function Lead({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`max-w-[60ch] text-base text-graphite ${className}`}>{children}</p>;
}
