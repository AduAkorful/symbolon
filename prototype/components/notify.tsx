"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * How one person is reached (spec §7.6, §11): the channels they've set up, their verified email addresses, and which
 * messages go where for each account they belong to. Personal, so it lives with the person, not the business.
 */
export type Channel = "Email" | "Slack" | "Telegram" | "Push";
export const CHANNELS: Channel[] = ["Email", "Slack", "Telegram", "Push"];

export interface EmailAddress {
  address: string;
  /** Which account it's used for by default */
  usedFor: string;
}

export interface AccountRouting {
  account: string;
  role: string;
  events: string[];
}

export const ACCOUNTS: AccountRouting[] = [
  {
    account: "Acme Operations",
    role: "Owner",
    events: ["Needs your approval", "Payment sent", "Invoice held", "Fraud or refusal", "Payout change requested", "Reserve moves", "Weekly digest"],
  },
  {
    account: "Studio Ana",
    role: "Your Seal",
    events: ["You’ve been paid", "An offer was countered", "An invoice was opened", "A client asked to verify you", "A payout or Seal change needs you"],
  },
];

const DEFAULT_ROUTES: Record<string, Channel[]> = {
  "Needs your approval": ["Email", "Slack", "Push"],
  "Payment sent": [],
  "Invoice held": ["Email"],
  "Fraud or refusal": ["Email", "Slack", "Push"],
  "Payout change requested": ["Email", "Slack", "Push"],
  "Reserve moves": [],
  "Weekly digest": ["Email"],
  "You’ve been paid": ["Email", "Push"],
  "An offer was countered": ["Email", "Push"],
  "An invoice was opened": [],
  "A client asked to verify you": ["Email", "Push"],
  "A payout or Seal change needs you": ["Email"],
};

interface Notify {
  connected: Record<Channel, boolean>;
  setConnected: (c: Channel, on: boolean) => void;
  emails: EmailAddress[];
  addEmail: (address: string) => void;
  removeEmail: (address: string) => void;
  routes: Record<string, Channel[]>;
  toggle: (event: string, c: Channel) => void;
  /** Details shown on each connected channel's card */
  detail: Record<Channel, string>;
  setDetail: (c: Channel, text: string) => void;
}

const noop = () => {};
const Ctx = createContext<Notify>({
  connected: { Email: true, Slack: false, Telegram: false, Push: false },
  setConnected: noop,
  emails: [],
  addEmail: noop,
  removeEmail: noop,
  routes: {},
  toggle: noop,
  detail: { Email: "", Slack: "", Telegram: "", Push: "" },
  setDetail: noop,
});

export function NotifyProvider({ children }: { children: ReactNode }) {
  // Email and Slack start connected so the routing has something to show; Telegram and Push are left to set up
  const [connected, setC] = useState<Record<Channel, boolean>>({ Email: true, Slack: true, Telegram: false, Push: false });
  const [emails, setEmails] = useState<EmailAddress[]>([
    { address: "owner@acme.example", usedFor: "Acme Operations" },
    { address: "ana@studio-ana.com", usedFor: "Studio Ana" },
  ]);
  const [routes, setRoutes] = useState<Record<string, Channel[]>>(DEFAULT_ROUTES);
  const [detail, setD] = useState<Record<Channel, string>>({ Email: "", Slack: "Acme workspace · #payables · linked as @owner", Telegram: "", Push: "" });

  const setConnected = useCallback((c: Channel, on: boolean) => setC((p) => ({ ...p, [c]: on })), []);
  const setDetail = useCallback((c: Channel, text: string) => setD((p) => ({ ...p, [c]: text })), []);
  const addEmail = useCallback((address: string) => setEmails((e) => [...e, { address, usedFor: "Extra address" }]), []);
  const removeEmail = useCallback((address: string) => setEmails((e) => e.filter((x) => x.address !== address)), []);
  const toggle = useCallback(
    (event: string, c: Channel) =>
      setRoutes((r) => {
        const cur = r[event] ?? [];
        return { ...r, [event]: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] };
      }),
    [],
  );

  const value = useMemo<Notify>(() => ({ connected, setConnected, emails, addEmail, removeEmail, routes, toggle, detail, setDetail }), [connected, setConnected, emails, addEmail, removeEmail, routes, toggle, detail, setDetail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useNotify = () => useContext(Ctx);
