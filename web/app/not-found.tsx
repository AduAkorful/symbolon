import Link from "next/link";
import { PublicHeader } from "@/components/public/PublicHeader";
import { PublicFooter } from "@/components/public/PublicFooter";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col justify-between">
      <PublicHeader />
      <main id="main-content" className="mx-auto max-w-[640px] px-6 py-20 text-center md:px-10">
        <Eyebrow>404 · Not found</Eyebrow>
        <PageTitle className="mt-4">We can’t find that page.</PageTitle>
        <p className="mt-4 text-graphite text-lg">
          The link you followed may be expired, mistyped, or belongs to a different account.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <Link href="/" className={buttonClass()}>
            Go home
          </Link>
          <Link href="/verify" className={buttonClass({ variant: "secondary" })}>
            Verify an invoice
          </Link>
          <Link href="/signin" className={buttonClass({ variant: "secondary" })}>
            Sign in
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
