import Link from "next/link";
import { Wordmark } from "@/components/Marks";
import { CONTAINER } from "@/components/shell/container";
import { buttonClass } from "@/components/ui/button";

/** The frame around pages anyone can open: no account, no navigation into the app */
export function PublicHeader() {
  return (
    <header className={`${CONTAINER} flex items-center justify-between gap-4 pt-7 print:hidden`} role="banner">
      <Link href="/" aria-label="Symbolon home">
        <Wordmark />
      </Link>
      <nav className="flex items-center gap-4 text-sm" aria-label="Public navigation">
        <Link href="/verify" className="hidden min-h-10 items-center text-graphite hover:text-ink sm:inline-flex">
          Verify an invoice
        </Link>
        <Link href="/stats" className="hidden min-h-10 items-center text-graphite hover:text-ink md:inline-flex">
          Numbers
        </Link>
        <Link href="/status" className="hidden min-h-10 items-center text-graphite hover:text-ink md:inline-flex">
          Status
        </Link>
        <Link href="/signin" className="inline-flex min-h-10 items-center text-graphite hover:text-ink">
          Sign in
        </Link>
        <Link href="/vendor/start" className={buttonClass({ size: "sm" })}>
          Start free
        </Link>
      </nav>
    </header>
  );
}
