import Link from "next/link";
import { DemoTag, Wordmark } from "@/components/Marks";

export function PublicHeader() {
  return (
    <header className="mx-auto flex max-w-[1180px] items-center justify-between px-6 pt-7 md:px-10 print:hidden">
      <Link href="/">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-4">
        <DemoTag />
        <Link href="/p/verify" className="text-sm text-graphite underline decoration-rule underline-offset-4 hover:text-ink">
          Verify an invoice
        </Link>
      </div>
    </header>
  );
}
