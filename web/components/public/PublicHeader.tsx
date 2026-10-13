import Link from "next/link";
import { Wordmark } from "@/components/Marks";
import { CONTAINER } from "@/components/shell/container";
import { SessionLinks } from "@/components/public/SessionLinks";

/** The frame around pages anyone can open: no account, no navigation into the app */
export function PublicHeader() {
  return (
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
  );
}
