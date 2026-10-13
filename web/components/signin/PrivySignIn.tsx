"use client";

import { useCreateWallet, useLogin, usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { InlineError } from "@/components/ui/States";
import { ApiError, postJson } from "@/lib/client/api";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How long a new email account's wallet is waited for before asking Privy for one, and how often the server is asked again */
const WALLET_WAIT_MS = 8_000;
const RETRY_EVERY_MS = 1_500;
const RETRIES = 10;

/**
 * Sign in with Privy (plan 05k, P1–P2): its own window takes the email code or the wallet signature. What comes back here is only
 * Privy's access token; the server checks it, asks Privy who this is, and starts our own session.
 *
 * A person signing in with an email has no wallet for a moment: Privy makes the embedded one after the code is accepted (plan
 * 05zj B, SYM-02). So this waits for the wallet before the first request, and a "still being set up" answer (503) is asked
 * again by itself. Only a definite refusal ends the Privy session; a busy moment never does, because that sent the person back to
 * an empty login to hit the same race again.
 */
export function PrivySignIn({ onDone }: { onDone: () => void }) {
  const { ready, authenticated, getAccessToken, logout, user } = usePrivy();
  const { createWallet } = useCreateWallet();
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [busy, setBusy] = useState(false);
  const exchanging = useRef(false);

  // the latest Privy user, readable from inside the waiting loop below
  const userRef = useRef(user);
  userRef.current = user;
  const hasWallet = () => Boolean(userRef.current?.linkedAccounts?.some((a) => a.type === "wallet"));

  async function waitForWallet() {
    const until = Date.now() + WALLET_WAIT_MS;
    while (!hasWallet() && Date.now() < until) await sleep(400);
    if (hasWallet()) return;
    try {
      await createWallet();
    } catch {
      // it was made in the meantime, or can't be made right now: the server decides, and asks again if it is not there yet
    }
  }

  async function exchange() {
    if (exchanging.current) return;
    exchanging.current = true;
    setBusy(true);
    setProblem(null);
    setCanRetry(false);
    try {
      setStatus("Setting up your wallet…");
      await waitForWallet();
      for (let attempt = 0; ; attempt++) {
        const accessToken = await getAccessToken();
        if (!accessToken) throw new ApiError("Sign in again.", 401);
        try {
          setStatus("Signing you in…");
          await postJson("/api/auth/privy", { accessToken });
          break;
        } catch (e) {
          const retryable = e instanceof ApiError && e.status === 503;
          if (!retryable || attempt >= RETRIES) throw e;
          setStatus("Setting up your wallet…");
          await sleep(RETRY_EVERY_MS);
        }
      }
      setStatus(null);
      onDone();
    } catch (e) {
      setStatus(null);
      // A Privy session the server definitely refused (not signed in, a wallet or email that belongs to another account) is dropped,
      // so the next attempt starts clean. A busy network, a slow wallet or a lost connection is not a reason to sign out.
      if (e instanceof ApiError && [401, 403, 409].includes(e.status)) await logout().catch(() => undefined);
      else setCanRetry(true);
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
      <Button className="w-full" size="md" disabled={!ready || busy} busy={busy} onClick={() => (authenticated ? void exchange() : login())}>
        {busy ? status ?? "Signing you in…" : canRetry ? "Try again" : ready ? "Continue" : "Getting ready…"}
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
