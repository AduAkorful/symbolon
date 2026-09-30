import Link from "next/link";
import { Wordmark } from "@/components/Marks";

/** The frame around pages anyone can open: no account, no navigation into the app */
export function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-6 pt-7 md:px-10 print:hidden" role="banner">
      <Link href="/" aria-label="Symbolon home">
        <Wordmark />
      </Link>
      <nav className="flex items-center gap-4 text-sm" aria-label="Public navigation">
        <Link href="/verify" className="hidden text-graphite hover:text-ink sm:inline">
          Verify an invoice
        </Link>
        <Link href="/status" className="hidden text-graphite hover:text-ink md:inline">
          Status
        </Link>
        <Link href="/signin" className="text-graphite hover:text-ink">
          Sign in
        </Link>
        <Link href="/vendor/start" className="rounded-doc bg-ink px-3.5 py-1.5 font-medium text-paper hover:bg-ink/90">
          Start free
        </Link>
      </nav>
    </header>
  );
}
