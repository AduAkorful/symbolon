import Link from "next/link";

export function PublicFooter() {
  return (
    <footer className="border-t border-rule mt-20 print:hidden" role="contentinfo">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-8 text-sm text-graphite md:px-10">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>Symbolon runs on Arc testnet</span>
          <span className="text-rule" aria-hidden>·</span>
          <Link href="/status" className="underline decoration-rule underline-offset-4 hover:text-ink">
            Live on Arc testnet — read contracts
          </Link>
        </div>
        <div className="flex items-center gap-6">
          <Link href="/verify" className="hover:text-ink">
            Verify
          </Link>
          <Link href="/status" className="hover:text-ink">
            Status
          </Link>
          <Link href="/signin" className="hover:text-ink">
            Sign in
          </Link>
        </div>
      </div>
    </footer>
  );
}
