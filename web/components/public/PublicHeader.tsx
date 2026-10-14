import Link from "next/link";
import { Wordmark } from "@/components/Marks";
import { CONTAINER } from "@/components/shell/container";
import { SessionLinks } from "@/components/public/SessionLinks";

/** The frame around pages anyone can open: no account, no navigation into the app */
export function PublicHeader() {
  return (
    <>
    <header className={`${CONTAINER} flex items-center justify-between gap-4 pt-7 print:hidden`} role="banner">
      <Link href="/" aria-label="Symbolon home">
        <Wordmark />
      </Link>
      <nav className="flex items-center gap-4 text-sm" aria-label="Public navigation">
        <Link href="/guide" className="hidden min-h-10 items-center text-graphite hover:text-ink sm:inline-flex">
          Get started
        </Link>
        <Link href="/verify" className="hidden min-h-10 items-center text-graphite hover:text-ink sm:inline-flex">
          Verify an invoice
        </Link>
        <Link href="/status" className="hidden min-h-10 items-center text-graphite hover:text-ink md:inline-flex">
          Status
        </Link>
        <SessionLinks />
      </nav>
    </header>
    {/* the links that sit in the header from tablet width up, kept on a phone as a row of their own (QA UI-14) */}
    <nav className={`${CONTAINER} mt-3 flex gap-5 text-sm text-graphite sm:hidden print:hidden`} aria-label="Public pages">
      <Link href="/guide" className="inline-flex min-h-10 items-center hover:text-ink">Get started</Link>
      <Link href="/verify" className="inline-flex min-h-10 items-center hover:text-ink">Verify an invoice</Link>
      <Link href="/status" className="inline-flex min-h-10 items-center hover:text-ink">Status</Link>
    </nav>
    </>
  );
}
