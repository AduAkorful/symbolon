"use client";

import { useEffect, useRef, useState } from "react";
import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import { postJson } from "@/lib/client/api";

type Phase = "email" | "code" | "wallet" | "finishing";

/**
 * Email sign-in through Circle. Circle emails the code and opens its own window to take it; the wallet is made behind the
 * scenes the first time. This page never sees the code, and the server, not this page, decides which email the sign-in is for.
 */
export function EmailSignIn({ appId, onDone }: { appId: string; onDone: () => void }) {
  const sdk = useRef<W3SSdk | null>(null);
  const challenge = useRef<string>("");
  const [phase, setPhase] = useState<Phase>("email");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A wallet takes a moment to appear after Circle makes it, so ask again a few times before giving up
  async function complete(userToken: string, tries = 0): Promise<void> {
    try {
      const r = await postJson<{ status: "signed-in" | "needs-wallet"; walletChallengeId?: string }>("/api/auth/email/complete", { challengeId: challenge.current, userToken });
      if (r.status === "signed-in") return onDone();
      return needWallet(userToken, r.walletChallengeId!);
    } catch (e) {
      if (tries < 4 && e instanceof Error && /isn't ready/.test(e.message)) {
        await new Promise((res) => setTimeout(res, 2000));
        return complete(userToken, tries + 1);
      }
      fail(e);
    }
  }

  function needWallet(userToken: string, walletChallengeId: string) {
    setPhase("wallet");
    // the encryption key from Circle's sign-in result was set as this session's authentication already
    sdk.current!.execute(walletChallengeId, (error) => {
      if (error) return fail(new Error(error.message || "Your wallet wasn't created."));
      setPhase("finishing");
      void new Promise((res) => setTimeout(res, 2000)).then(() => complete(userToken));
    });
  }

  function fail(e: unknown) {
    setProblem(e instanceof Error ? e.message : "Sign-in didn't finish.");
    setBusy(false);
    setPhase("email");
  }

  useEffect(() => {
    let cancelled = false;
    void import("@circle-fin/w3s-pw-web-sdk").then(({ W3SSdk }) => {
      if (cancelled) return;
      sdk.current = new W3SSdk({ appSettings: { appId } }, (error, result) => {
        if (error || !result) return fail(new Error(error?.message || "The code wasn't accepted."));
        setPhase("finishing");
        sdk.current!.setAuthentication({ userToken: result.userToken, encryptionKey: result.encryptionKey });
        void complete(result.userToken);
      });
    });
    return () => {
      cancelled = true;
    };
    // the SDK is made once; its callbacks read only refs and stable setters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!sdk.current) return setProblem("Sign-in is still loading. Try again in a moment.");
    setBusy(true);
    setProblem(null);
    try {
      const deviceId = await sdk.current.getDeviceId();
      const s = await postJson<{ challengeId: string; deviceToken: string; deviceEncryptionKey: string; otpToken: string }>("/api/auth/email/start", { email, deviceId });
      challenge.current = s.challengeId;
      sdk.current.updateConfigs({ appSettings: { appId }, loginConfigs: { deviceToken: s.deviceToken, deviceEncryptionKey: s.deviceEncryptionKey, otpToken: s.otpToken } });
      setPhase("code");
      setBusy(false);
      sdk.current.verifyOtp();
    } catch (err) {
      fail(err);
    }
  }

  if (phase === "email")
    return (
      <form onSubmit={send}>
        <label className="block text-sm">
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-doc border border-rule bg-paper px-3 py-2.5 focus:border-ink focus:outline-none" />
        </label>
        <button disabled={busy} className="mt-5 w-full rounded-doc bg-ink py-3 font-medium text-paper disabled:opacity-40">
          {busy ? "Sending…" : "Email me a code"}
        </button>
        {problem ? (
          <p role="alert" className="mt-3 text-sm text-red">
            {problem}
          </p>
        ) : null}
      </form>
    );

  return (
    <div role="status" className="rounded-doc border border-rule p-5 text-sm">
      {phase === "code" ? (
        <>
          <p className="font-medium">Check your email</p>
          <p className="mt-1 text-graphite">We sent a 6-digit code to {email}. Enter it in the window that opened. It works for 10 minutes.</p>
          <button type="button" onClick={() => setPhase("email")} className="mt-4 underline decoration-rule underline-offset-4">
            Use a different email
          </button>
        </>
      ) : phase === "wallet" ? (
        <p>Setting up your wallet. Follow the steps in the window that opened.</p>
      ) : (
        <p>Signing you in…</p>
      )}
    </div>
  );
}
