"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { useFormStatus } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { openBusiness } from "@/app/actions";
import { Avatar } from "@/components/Avatar";
import { postJson } from "@/lib/client/api";
import { useConfirm } from "@/components/useConfirm";

export interface SwitcherSpaces {
  seal: { handle: string; displayName: string } | null;
  businesses: { id: string; name: string; role: string }[];
}

export type Current = { kind: "vendor" } | { kind: "business"; id: string };

const item = "flex min-h-11 w-full items-center gap-3 rounded-doc px-2.5 py-2 text-left text-sm outline-none hover:bg-rule-soft/70 focus-visible:bg-rule-soft/70 focus-visible:ring-2 focus-visible:ring-seal";
const quiet = "flex min-h-10 w-full items-center rounded-doc px-2.5 py-1.5 text-left text-sm text-graphite outline-none hover:text-ink focus-visible:text-ink focus-visible:ring-2 focus-visible:ring-seal";

/** Switch between your Seal and each business you belong to, and sign out. One person can be both a vendor and a business owner. */
/** One business in the menu. Switching takes a few seconds (the server reads the Vault), so the row says it is opening and can't be clicked twice (QA R1-N8d). */
function BusinessOption({ name, role, here, itemClass }: { name: string; role: string; here: boolean; itemClass: string }) {
  const { pending } = useFormStatus();
  return (
    <button role="menuitem" data-current={here} disabled={pending} aria-busy={pending} className={`${itemClass} ${pending ? "opacity-70" : ""}`}>
      <Avatar name={name} size={24} />
      <span className="min-w-0 flex-1">
        <span className="block break-words font-medium leading-snug">{name}</span>
        <span className="block truncate text-xs capitalize text-graphite">{pending ? "Opening…" : role}</span>
      </span>
      {pending ? <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-rule border-t-ink" /> : here ? <span aria-label="Current account" className="text-seal">✓</span> : null}
    </button>
  );
}

export function SpaceSwitcher({ spaces, current, who, wallet = null, compact = false }: { spaces: SwitcherSpaces; current: Current; who: string; wallet?: string | null; compact?: boolean }) {
  const { logout } = usePrivy();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [ask, confirmDialog] = useConfirm();
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const now =
    current.kind === "vendor"
      ? { name: spaces.seal?.displayName ?? "Your Seal", role: spaces.seal ? `Your Seal · @${spaces.seal.handle}` : "No Seal yet" }
      : (() => {
          const b = spaces.businesses.find((x) => x.id === current.id);
          return { name: b?.name ?? "No business yet", role: b ? b.role[0]!.toUpperCase() + b.role.slice(1) : "Not a member of one" };
        })();

  // Opening puts the keyboard on the current account, so arrows, Enter and Escape all work without the mouse
  useEffect(() => {
    if (!open) return;
    const items = ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]");
    (items ? Array.from(items).find((i) => i.dataset.current === "true") ?? items[0] : undefined)?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
    else if (e.key === "Home") items[0]?.focus();
    else if (e.key === "End") items[items.length - 1]?.focus();
    else if (e.key === "Escape") {
      setOpen(false);
      trigger.current?.focus();
    } else return;
    e.preventDefault();
  };

  async function signOut(everywhere: boolean) {
    setProblem(null);
    // "everywhere" ends every session of this person, on every device, and used to do it on the first click (plan 05zj G, SYM-41)
    if (everywhere) {
      setOpen(false);
      const yes = await ask({
        title: "Sign out everywhere?",
        body: "This ends every session of yours on every device and browser, including this one. You will sign in again with your email or wallet.",
        confirmLabel: "Sign out everywhere",
        destructive: true,
      });
      if (!yes) return;
    }
    setSigningOut(true);
    try {
      await postJson(everywhere ? "/api/auth/signout-all" : "/api/auth/signout");
      await logout().catch(() => undefined);
      router.push("/signin");
      router.refresh();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't sign out. Try again.");
      setSigningOut(false);
    }
  }

  return (
    <div ref={ref} className="relative">
      {confirmDialog}
      <button
        ref={trigger}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex min-h-11 items-center gap-2 rounded-doc border border-rule px-3 py-2 text-left text-sm hover:border-ink/50 sm:min-h-10 ${compact ? "max-w-[8.5rem] sm:max-w-[16rem]" : "w-full"}`}
      >
        <Avatar name={now.name} size={24} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium leading-tight">{now.name}</span>
          {!compact ? <span className="hidden truncate text-xs text-graphite lg:block">{now.role}</span> : null}
        </span>
        <span aria-hidden className="text-graphite">▾</span>
      </button>
      {open ? (
        <div role="menu" aria-label="Switch account" onKeyDown={onMenuKey} className={`menu-in absolute right-0 top-full z-50 mt-1.5 origin-top rounded-doc border border-rule bg-paper-raised p-1.5 shadow-xl ${
            // hangs from the button's right edge so it can't run off a phone screen; in the wide sidebar it matches the button's width
            compact ? "min-w-[15rem] max-w-[min(22rem,calc(100vw-2rem))]" : "min-w-[17rem] lg:left-0 lg:min-w-0"
          }`}>
          <p className="truncate px-2.5 pb-1.5 pt-1 text-xs text-graphite">
            Signed in as <span className="text-ink">{who}</span>
          </p>
          {wallet && who.toLowerCase() !== wallet.toLowerCase() && !who.startsWith("0x") ? (
            <p className="break-all px-2.5 pb-1.5 font-mono text-[11px] text-graphite" title="Your wallet: your Seal, and where payouts go">{wallet}</p>
          ) : null}
          {spaces.seal ? (
            <Link role="menuitem" href="/vendor" data-current={current.kind === "vendor"} onClick={() => setOpen(false)} className={`${item} ${current.kind === "vendor" ? "bg-rule-soft/50" : ""}`}>
              <Avatar name={spaces.seal.displayName} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block break-words font-medium leading-snug">{spaces.seal.displayName}</span>
                <span className="block truncate text-xs text-graphite">Your Seal · @{spaces.seal.handle}</span>
              </span>
              {current.kind === "vendor" ? <span aria-label="Current account" className="text-seal">✓</span> : null}
            </Link>
          ) : null}
          {spaces.businesses.map((b) => {
            const here = current.kind === "business" && current.id === b.id;
            return (
              <form key={b.id} action={openBusiness}>
                <input type="hidden" name="id" value={b.id} />
                <BusinessOption name={b.name} role={b.role} here={here} itemClass={`${item} ${here ? "bg-rule-soft/50" : ""}`} />
              </form>
            );
          })}
          {!spaces.seal && spaces.businesses.length === 0 ? <p className="px-2.5 py-2 text-sm text-graphite">You don’t belong to a Seal or a business yet.</p> : null}
          <div className="mt-1 border-t border-rule pt-1">
            <Link role="menuitem" href="/profile" onClick={() => setOpen(false)} className={quiet}>
              Your profile
            </Link>
            <Link role="menuitem" href="/setup" onClick={() => setOpen(false)} className={quiet}>
              Set up a business
            </Link>
            <button role="menuitem" disabled={signingOut} onClick={() => signOut(false)} className={quiet}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
            <button role="menuitem" disabled={signingOut} onClick={() => signOut(true)} className={quiet}>
              Sign out everywhere
            </button>
            {problem ? (
              <p role="alert" className="px-2.5 py-1.5 text-xs text-red">
                {problem}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
