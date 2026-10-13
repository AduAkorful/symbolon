"use client";

import { useRouter } from "next/navigation";
import { PrivySignIn } from "./PrivySignIn";

/** Sign in (A1): one flow. Privy takes an email or a wallet you already use. */
/** What the person is signing in to do, read from where they were headed (plan 05zj G, SYM-38) */
function intentOf(next: string): "vendor" | "business" | null {
  if (next.startsWith("/vendor")) return "vendor";
  if (next.startsWith("/setup") || next.startsWith("/business")) return "business";
  return null;
}

export function SignInForm({ next }: { next: string }) {
  const intent = intentOf(next);
  const router = useRouter();
  const done = () => {
    router.push(next);
    router.refresh();
  };

  return (
    <div>
      <h1 className="font-display text-5xl leading-none">Sign in</h1>
      <p className="mt-3 text-graphite">With your email, or a wallet you already use.</p>
      {intent === "vendor" ? (
        <p className="mt-3 text-sm text-graphite">
          You are signing in to send invoices. An email gets a wallet made for you. Sealing an invoice is a signature and costs nothing.
        </p>
      ) : intent === "business" ? (
        <p className="mt-3 text-sm text-graphite">
          You are signing in to set up a business. You will need a little testnet USDC in the wallet you sign in with: creating and funding a Vault pay
          Arc&apos;s network fee in USDC. <a href="/guide" className="underline decoration-rule underline-offset-4">How to get some</a>.
        </p>
      ) : null}
      <div className="mt-8">
        <PrivySignIn onDone={done} />
      </div>
      <noscript>
        <p className="mt-4 text-sm text-graphite">Signing in needs JavaScript.</p>
      </noscript>
    </div>
  );
}
