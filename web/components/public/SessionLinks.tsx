"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui/button";

/**
 * The right-hand links of the public header. Public pages are served without reading the cookie (so they stay cacheable); this
 * asks once, in the browser, whether there is a session and swaps "Sign in / Start free" for "Open the app". Until the answer
 * arrives the links are present but invisible, so nothing jumps and nobody is shown the wrong pair.
 */
export function SessionLinks() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { signedIn: false }))
      .then((d: { signedIn?: boolean }) => live && setSignedIn(d.signedIn === true))
      .catch(() => live && setSignedIn(false));
    return () => {
      live = false;
    };
  }, []);

  const hidden = signedIn === null ? "invisible" : "";
  if (signedIn) {
    return (
      <Link href="/signin" className={buttonClass({ size: "sm" })}>
        Open the app
      </Link>
    );
  }
  return (
    <>
      <Link href="/signin" className={`inline-flex min-h-10 items-center text-graphite hover:text-ink ${hidden}`}>
        Sign in
      </Link>
      <Link href="/vendor/start" className={`${buttonClass({ size: "sm" })} ${hidden}`}>
        Start free
      </Link>
    </>
  );
}
