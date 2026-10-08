"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { InlineError, InlineLoading } from "@/components/ui/States";
import { SectionTitle } from "@/components/ui/Type";
import { postJson } from "@/lib/client/api";
import { formatDateTime } from "@/lib/format";
import type { FormattedNotification } from "@/lib/server/notifications";

/**
 * The bell and its panel. Notices open over whatever page the person is on and close again, so reading them never means
 * leaving the page or going back to it. Each notice links to what it is about; opening that link marks it read.
 */
export function Bell({ unreadCount: initialUnread }: { unreadCount: number }) {
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<FormattedNotification[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => setUnread(initialUnread), [initialUnread]);

  const load = useCallback(async () => {
    setLoading(true);
    setProblem(null);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error("Couldn't load your notifications.");
      const data = (await res.json()) as { items: FormattedNotification[]; unreadCount: number };
      setItems(data.items);
      setUnread(data.unreadCount);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't load your notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Escape and a click anywhere else close it; focus goes back to the bell
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function mark(action: "read" | "unread" | "read-all", ids?: string[]) {
    setProblem(null);
    try {
      await postJson("/api/notifications", { action, ids });
      setItems((prev) =>
        prev?.map((n) => (action === "read-all" || ids?.includes(n.id) ? { ...n, readAt: action === "unread" ? null : (n.readAt ?? new Date().toISOString()) } : n)) ?? prev,
      );
      setUnread((c) => (action === "read-all" ? 0 : Math.max(0, c + (action === "unread" ? ids!.length : -ids!.length))));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't update your notifications.");
    }
  }

  const count = unread > 99 ? "99+" : String(unread);

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ""}`}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-11 w-11 items-center justify-center rounded-doc text-graphite transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal sm:h-10 sm:w-10"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 ? (
          <span className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-seal px-1 text-xs font-semibold leading-none text-paper">{count}</span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className="fixed inset-x-4 top-[4.25rem] z-50 max-h-[min(34rem,calc(100vh-6rem))] overflow-y-auto rounded-doc border border-rule bg-paper-raised shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[26rem]"
        >
          <div className="sticky top-0 flex items-center justify-between gap-3 border-b border-rule bg-paper-raised px-4 py-3">
            <SectionTitle as="h2" className="text-xl">Notifications</SectionTitle>
            {unread > 0 ? (
              <Button variant="quiet" size="sm" onClick={() => void mark("read-all")}>
                Mark all read
              </Button>
            ) : null}
          </div>

          <div className="px-4 py-3">
            {problem ? <InlineError className="mb-3">{problem}</InlineError> : null}
            {loading && !items ? (
              <InlineLoading>Loading…</InlineLoading>
            ) : items && items.length === 0 ? (
              <p className="py-6 text-center text-sm text-graphite">Nothing needs you. When an invoice needs approval or a payment lands, it shows up here.</p>
            ) : (
              <ol aria-label="Notifications" className="divide-y divide-rule-soft">
                {items?.map((n) => {
                  const isRead = n.readAt !== null;
                  const body = (
                    <>
                      <span className="flex items-start gap-2.5">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${isRead ? "bg-transparent" : "bg-seal"}`} aria-hidden />
                        <span className="min-w-0">
                          <span className={`block text-sm ${isRead ? "text-graphite" : "font-medium text-ink"}`}>{n.title}</span>
                          <span className="mt-0.5 block text-sm text-graphite">{n.body}</span>
                          <time dateTime={n.createdAt} className="mt-1 block text-xs text-graphite">{formatDateTime(n.createdAt)}</time>
                        </span>
                      </span>
                      <span className="sr-only">{isRead ? "Read" : "Unread"}</span>
                    </>
                  );
                  return (
                    <li key={n.id} className="py-3 first:pt-0 last:pb-0">
                      {n.href ? (
                        <Link
                          href={n.href}
                          onClick={() => {
                            if (!isRead) void mark("read", [n.id]);
                            setOpen(false);
                          }}
                          className="block rounded-doc hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal"
                        >
                          {body}
                        </Link>
                      ) : (
                        <div>
                          {body}
                          {!isRead ? (
                            <Button variant="quiet" size="sm" className="ml-4 mt-1" onClick={() => void mark("read", [n.id])}>
                              Mark read
                            </Button>
                          ) : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
