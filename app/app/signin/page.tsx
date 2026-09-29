import Link from "next/link";
import { redirect } from "next/navigation";
import { openBusiness } from "@/app/actions";
import { Avatar } from "@/components/Avatar";
import { Wordmark } from "@/components/Marks";
import { PrivyBoundary } from "@/components/providers/PrivyBoundary";
import { SignInForm } from "@/components/signin/SignInForm";
import { safeNext } from "@/lib/next-path";
import { getConfig } from "@/lib/server/config";
import { getSession } from "@/lib/server/http";
import { loadSpaces } from "@/lib/server/space";

export const dynamic = "force-dynamic";

/** Sign in (A1) and, once signed in, pick a space (A2) */
export default async function SignIn({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const config = getConfig();
  const next = safeNext((await searchParams).next, "/signin");
  const session = await getSession();

  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-[980px] items-center justify-between px-6 pt-7">
        <Link href="/" aria-label="Symbolon home">
          <Wordmark />
        </Link>
        <span className="rounded-full border border-rule px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
          {config.testnet ? "Arc testnet" : "Arc mainnet"}
        </span>
      </header>
      <main className="mx-auto max-w-md px-6 pb-24 pt-20">
        {session ? (
          <Where session={session} next={next} />
        ) : (
          config.privy ? (
            <PrivyBoundary>
              <SignInForm next={next} />
            </PrivyBoundary>
          ) : (
            <div>
              <h1 className="font-display text-5xl leading-none">Sign in</h1>
              <p role="alert" className="mt-3 text-graphite">Sign-in isn’t set up on this server yet, so nobody can sign in. The server needs its Privy settings.</p>
            </div>
          )
        )}
      </main>
    </div>
  );
}

async function Where({ session, next }: { session: NonNullable<Awaited<ReturnType<typeof getSession>>>; next: string }) {
  // Someone who arrived from a page they were sent away from goes straight back to it
  if (next !== "/signin") redirect(next);
  const { spaces } = await loadSpaces(session);
  const empty = !spaces.seal && spaces.businesses.length === 0;
  return (
    <div>
      <h1 className="font-display text-5xl leading-none">Where to?</h1>
      {empty ? (
        <p className="mt-6 text-graphite">
          You’re signed in, but you don’t belong to a Seal or a business yet.{" "}
          <Link href="/setup" className="text-ink underline decoration-rule underline-offset-4">
            Set up a business
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-8 space-y-3">
          {spaces.seal ? (
            <li>
              <Link href="/vendor" className="flex items-center gap-4 rounded-doc border border-rule p-4 hover:border-ink">
                <Avatar name={spaces.seal.displayName} size={36} />
                <span>
                  <span className="block font-medium">{spaces.seal.displayName}</span>
                  <span className="block text-sm text-graphite">Your Seal · invoices you send</span>
                </span>
              </Link>
            </li>
          ) : null}
          {spaces.businesses.map((b) => (
            <li key={b.id}>
              <form action={openBusiness}>
                <input type="hidden" name="id" value={b.id} />
                <button className="flex w-full items-center gap-4 rounded-doc border border-rule p-4 text-left hover:border-ink">
                  <Avatar name={b.name} size={36} />
                  <span>
                    <span className="block font-medium">{b.name}</span>
                    <span className="block text-sm capitalize text-graphite">{b.role} · bills you pay</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
