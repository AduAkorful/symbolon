import Link from "next/link";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className="mx-auto max-w-[640px] px-6 py-20 text-center md:px-10">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-graphite">404 · Not found</p>
        <h1 className="mt-4 font-display text-4xl leading-tight md:text-5xl">We can’t find that page.</h1>
        <p className="mt-4 text-graphite text-lg">
          The link you followed may be expired, mistyped, or belongs to a different account.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/" className="rounded-doc bg-ink px-5 py-2.5 font-medium text-paper hover:bg-ink/90">
            Go home
          </Link>
          <Link href="/verify" className="rounded-doc border border-rule px-5 py-2.5 font-medium hover:bg-paper-raised">
            Verify an invoice
          </Link>
          <Link href="/signin" className="rounded-doc border border-rule px-5 py-2.5 font-medium hover:bg-paper-raised">
            Sign in
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
