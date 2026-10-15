"use client";

import { useCallback, useRef, useState } from "react";

import { TxLink } from "@/components/TxLink";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/Callout";
import { isStillConfirming } from "@/lib/client/api";

/**
 * Where a transaction the person sends from their wallet has got to (plan 05zj A, SYM-03).
 *
 * The old flow sent, asked the server to record it once, and on any failure forgot the hash and put the Send button back, so a
 * transaction that had worked looked like it hadn't and invited a second one. Here, once the wallet returns a hash:
 * the hash is kept, `locked` turns on (the caller disables Send with it), recording is retried by itself (`record` should be
 * `postRecord`), and if Arc still hasn't confirmed, the person sees the hash and a "Check again" button. Nothing ever sends
 * twice from this state.
 */
export type SentPhase = "idle" | "sending" | "recording" | "unconfirmed" | "failed" | "done";

export function useSentTransaction() {
  const [hash, setHash] = useState<string | null>(null);
  const [phase, setPhase] = useState<SentPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<{ record: (hash: string) => Promise<unknown>; onDone?: (result: unknown, hash: string) => void } | null>(null);
  const inFlight = useRef(false);

  const settle = useCallback(async (sent: string) => {
    const job = pending.current;
    if (!job) return;
    setError(null);
    setPhase("recording");
    let result: unknown;
    try {
      result = await job.record(sent);
    } catch (e) {
      // The transaction exists. Whatever went wrong now, the person is shown the hash and can check again; it is never sent again.
      setError(e instanceof Error ? e.message : "Couldn't confirm the transaction yet.");
      setPhase(isStillConfirming(e) ? "unconfirmed" : "failed");
      return;
    }
    setPhase("done");
    pending.current = null;
    // outside the try: a fault in what the caller does next is its own, and must not look like an unconfirmed transaction
    job.onDone?.(result, sent);
  }, []);

  /**
   * Sends, then records. Throws only when nothing was sent (the wallet refused, a preparation failed): the caller shows that and
   * the button stays live. After a hash exists nothing is thrown; the state above says what is happening.
   */
  const run = useCallback(
    async <T,>(job: { send: () => Promise<string>; record: (hash: string) => Promise<T>; onDone?: (result: T, hash: string) => void }) => {
      // a second activation before the screen has re-rendered (a double click, Enter plus click) must not open a second
      // wallet request: the guard is synchronous, state is not (plan 05zu 3.7, QA PAY-dup)
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setPhase("sending");
      let sent: string;
      try {
        sent = await job.send();
      } catch (e) {
        inFlight.current = false;
        setPhase("idle");
        throw e;
      }
      pending.current = { record: job.record, onDone: job.onDone as ((result: unknown, hash: string) => void) | undefined };
      setHash(sent);
      await settle(sent);
      inFlight.current = false;
    },
    [settle],
  );

  const check = useCallback(() => (hash ? settle(hash) : Promise.resolve()), [hash, settle]);
  const reset = useCallback(() => {
    inFlight.current = false;
    pending.current = null;
    setHash(null);
    setPhase("idle");
    setError(null);
  }, []);

  return {
    hash,
    phase,
    error,
    run,
    check,
    reset,
    /** A transaction was sent and isn't settled: sending another from this dialog would be a second payment */
    locked: hash !== null && phase !== "done",
    /** The wallet window, or the wait after it, is open */
    busy: phase === "sending" || phase === "recording",
  };
}

export type SentTransaction = ReturnType<typeof useSentTransaction>;

/** The notice for a sent transaction that is still being confirmed: its hash as a link, what is happening, and "Check again" */
export function SentTransactionNotice({ tx, explorer }: { tx: SentTransaction; explorer: string }) {
  if (!tx.hash || tx.phase === "done" || tx.phase === "idle" || tx.phase === "sending") return null;
  const link = (
    <TxLink href={`${explorer}/tx/${tx.hash}`} label={`View transaction ${tx.hash} on the Arc explorer`}>
      {tx.hash.slice(0, 10)}…{tx.hash.slice(-6)}
    </TxLink>
  );
  if (tx.phase === "recording") {
    return (
      <Callout tone="info" title="Sent. Waiting for Arc to confirm it…" className="mt-4">
        Your transaction {link} is on its way. Don’t send it again.
      </Callout>
    );
  }
  return (
    <Callout
      tone="warn"
      title="Your transaction was sent"
      className="mt-4"
      actions={<Button variant="secondary" size="sm" onClick={() => void tx.check()}>Check again</Button>}
    >
      <p>{tx.error ?? "Arc hasn't shown it yet."} Your transaction {link} may already have been confirmed. Don’t send it again; check it here.</p>
    </Callout>
  );
}

/**
 * The same rule for lists of actions, where one screen sends several transactions (a queued change's Apply or Cancel on each row):
 * a hash that was sent for a row is kept under that row's key, so the row's button checks it again instead of sending a second one.
 */
export function useSentHashes() {
  const [hashes, setHashes] = useState<Record<string, string>>({});
  return {
    get: (key: string): string | undefined => hashes[key],
    set: (key: string, hash: string) => setHashes((h) => ({ ...h, [key]: hash })),
    clear: (key: string) =>
      setHashes((h) => {
        if (!(key in h)) return h;
        const { [key]: _gone, ...rest } = h;
        return rest;
      }),
  };
}
