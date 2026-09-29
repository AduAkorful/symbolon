"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { postJson } from "@/lib/client/api";

/**
 * Sign in with Privy (plan 05k, P1–P2): its own window takes the email code or the wallet signature. What comes back here is only
 * Privy's access token; the server checks it, asks Privy who this is, and starts our own session.
 */
export function PrivySignIn({ onDone }: { onDone: () => void }) {
  const { ready, authenticated, getAccessToken, logout } = usePrivy();
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const exchanging = useRef(false);

  async function exchange() {
    if (exchanging.current) return;
    exchanging.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Sign in again.");
      await postJson("/api/auth/privy", { accessToken });
      onDone();
    } catch (e) {
      // A Privy session we couldn't turn into ours is dropped, so the next attempt starts clean
      await logout().catch(() => undefined);
      setProblem(e instanceof Error ? e.message : "Couldn't sign in. Try again.");
      setBusy(false);
      exchanging.current = false;
    }
  }

  const { login } = useLogin({
    onComplete: () => void exchange(),
    onError: (code) => setProblem(code === "exited_auth_flow" ? null : "Couldn't sign in. Try again."),
  });

  // Signed in at Privy but without a session of ours (an expired cookie, say): finish the job without asking again
  useEffect(() => {
    if (ready && authenticated && !exchanging.current) void exchange();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated]);

  return (
    <div>
      <button type="button" disabled={!ready || busy} onClick={() => login()} className="w-full rounded-doc border border-rule py-3 hover:border-ink disabled:opacity-50">
        {busy ? "Signing you in…" : ready ? "Continue" : "Loading…"}
      </button>
      {problem ? (
        <p role="alert" className="mt-3 text-sm text-red">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
