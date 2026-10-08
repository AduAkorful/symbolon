"use client";

import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { InlineError } from "@/components/ui/States";
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

  // Privy's script can fail to load (offline, a blocker, a wrong domain); say so instead of leaving "Loading…" up for good
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (ready) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <div className="space-y-4">
      <Button className="w-full" size="md" disabled={!ready} busy={busy} onClick={() => login()}>
        {busy ? "Signing you in…" : ready ? "Continue" : "Getting ready…"}
      </Button>
      {slow && !ready ? (
        <Callout tone="warn" title="Sign-in is taking too long to load" actions={<Button variant="secondary" size="sm" onClick={() => window.location.reload()}>Reload the page</Button>}>
          The sign-in window comes from Privy. Check your connection, and that nothing (a content blocker, a firewall) is blocking it, then reload.
        </Callout>
      ) : null}
      {problem ? <InlineError>{problem}</InlineError> : null}
    </div>
  );
}
