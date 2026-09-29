"use client";

import { useRouter } from "next/navigation";
import { PrivySignIn } from "./PrivySignIn";

/** Sign in (A1): one flow. Privy takes an email or a wallet you already use. */
export function SignInForm({ next }: { next: string }) {
  const router = useRouter();
  const done = () => {
    router.push(next);
    router.refresh();
  };

  return (
    <div>
      <h1 className="font-display text-5xl leading-none">Sign in</h1>
      <p className="mt-3 text-graphite">With your email, or a wallet you already use.</p>
      <div className="mt-8">
        <PrivySignIn onDone={done} />
      </div>
      <noscript>
        <p className="mt-4 text-sm text-graphite">Signing in needs JavaScript.</p>
      </noscript>
    </div>
  );
}
