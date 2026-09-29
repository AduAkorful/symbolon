"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { postJson } from "@/lib/client/api";
import { EmailSignIn } from "./EmailSignIn";
import { WalletSignIn } from "./WalletSignIn";

export interface SignInOptions {
  /** Circle's App ID when email sign-in is set up on this server */
  emailAppId: string | null;
  /** Local test users, only in a development build on a testnet */
  devUsers: { key: string; label: string }[];
}

/** Sign in (A1): with your email, with a wallet you already use, or (development only) as a test user */
export function SignInForm({ options, next }: { options: SignInOptions; next: string }) {
  const router = useRouter();
  const [problem, setProblem] = useState<string | null>(null);
  const done = () => {
    router.push(next);
    router.refresh();
  };

  async function dev(key: string) {
    setProblem(null);
    try {
      await postJson("/api/auth/dev", { key });
      done();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't sign in.");
    }
  }

  return (
    <div>
      <h1 className="font-display text-5xl leading-none">Sign in</h1>
      <p className="mt-3 text-graphite">{options.emailAppId ? "With your email, or a wallet you already use." : "With a wallet you already use."}</p>

      <div className="mt-8 space-y-6">
        {options.emailAppId ? (
          <>
            <EmailSignIn appId={options.emailAppId} onDone={done} />
            <div className="flex items-center gap-3 text-sm text-graphite">
              <span className="h-px flex-1 bg-rule" /> or <span className="h-px flex-1 bg-rule" />
            </div>
          </>
        ) : null}
        <WalletSignIn onDone={done} />
      </div>

      {options.devUsers.length > 0 ? (
        <section aria-labelledby="dev-h" className="mt-10 rounded-doc border border-dashed border-rule p-4">
          <h2 id="dev-h" className="font-mono text-[10px] uppercase tracking-[0.14em] text-graphite">
            Development build · test users
          </h2>
          <p className="mt-1 text-xs text-graphite">No wallet or code. This section doesn’t exist in a deployed build.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {options.devUsers.map((u) => (
              <button key={u.key} type="button" onClick={() => dev(u.key)} className="rounded-doc border border-rule px-3.5 py-2 text-sm hover:border-ink">
                Sign in as {u.label.toLowerCase()}
              </button>
            ))}
          </div>
          {problem ? (
            <p role="alert" className="mt-3 text-sm text-red">
              {problem}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
