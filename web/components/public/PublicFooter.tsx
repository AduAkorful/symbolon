import Link from "next/link";

import { CONTAINER } from "@/components/shell/container";

export function PublicFooter() {
  return (
    <footer className="border-t border-rule mt-20 print:hidden" role="contentinfo">
      <div className={`${CONTAINER} flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-8 text-sm text-graphite`}>
        <p>
          Symbolon runs on Arc testnet.{" "}
          <Link href="/status" className="underline decoration-rule underline-offset-4 hover:text-ink">Read the contracts</Link>
        </p>
        <nav aria-label="Footer" className="flex items-center gap-6">
          <Link href="/verify" className="inline-flex min-h-10 items-center hover:text-ink">
            Verify
          </Link>
          <Link href="/status" className="inline-flex min-h-10 items-center hover:text-ink">
            Status
          </Link>
          <Link href="/signin" className="inline-flex min-h-10 items-center hover:text-ink">
            Sign in
          </Link>
        </nav>
      </div>
    </footer>
  );
}
