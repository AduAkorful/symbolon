import Link from "next/link";
import { Wordmark } from "@/components/Marks";

/** The frame around pages anyone can open: no account, no navigation into the app */
export function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10 print:hidden">
      <Link href="/" aria-label="Symbolon home">
        <Wordmark />
      </Link>
      <Link href="/verify" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
        Verify an invoice
      </Link>
    </header>
  );
}
