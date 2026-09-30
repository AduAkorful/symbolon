"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/client/api";
import type { FormattedNotification } from "@/lib/server/notifications";

export function NotificationList({ initialItems, initialUnreadCount }: { initialItems: FormattedNotification[]; initialUnreadCount: number }) {
  const router = useRouter();
  const [items, setItems] = useState<FormattedNotification[]>(initialItems);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [problem, setProblem] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleMarkAllRead() {
    setProblem(null);
    try {
      await postJson("/api/notifications", { action: "read-all" });
      setItems((prev) => prev.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(0);
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't update notifications.");
    }
  }

  async function handleToggleRead(id: string, isRead: boolean) {
    setProblem(null);
    const action = isRead ? "unread" : "read";
    try {
      await postJson("/api/notifications", { action, ids: [id] });
      setItems((prev) =>
        prev.map((item) => {
          if (item.id === id) {
            return { ...item, readAt: isRead ? null : new Date().toISOString() };
          }
          return item;
        }),
      );
      setUnreadCount((c) => Math.max(0, isRead ? c + 1 : c - 1));
      startTransition(() => {
        router.refresh();
      });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : "Couldn't update notification.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-rule pb-4">
        <div>
          <h1 className="font-display text-4xl">Notifications</h1>
          <p className="mt-1 text-sm text-graphite">
            Notices from your businesses and your Seal. In-app is currently the active channel.
          </p>
        </div>
        {unreadCount > 0 ? (
          <button
            onClick={handleMarkAllRead}
            disabled={isPending}
            className="rounded-doc border border-rule px-3 py-1.5 text-xs font-medium text-ink transition hover:border-ink/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal disabled:opacity-50"
          >
            Mark all read
          </button>
        ) : null}
      </div>

      {problem ? (
        <div role="alert" className="rounded-doc border border-red/30 bg-red-wash px-4 py-2.5 text-sm text-red">
          {problem}
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="py-16 text-center">
          <p className="font-display text-2xl text-ink">Nothing needs you.</p>
          <p className="mt-1 text-sm text-graphite">When an invoice needs approval or an onchain settlement completes, you'll see it here.</p>
        </div>
      ) : (
        <ol className="divide-y divide-rule border-b border-rule" aria-label="Notifications list">
          {items.map((item) => {
            const isRead = item.readAt !== null;
            return (
              <li
                key={item.id}
                className={`flex flex-col gap-2 py-4 transition sm:flex-row sm:items-start sm:justify-between ${
                  isRead ? "opacity-75" : "bg-paper-raised/30"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                      isRead ? "bg-transparent" : "bg-seal"
                    }`}
                    aria-label={isRead ? "Read" : "Unread"}
                  />
                  <div>
                    <h2 className="font-medium text-ink">
                      {item.href ? (
                        <Link href={item.href} className="hover:underline">
                          {item.title}
                        </Link>
                      ) : (
                        item.title
                      )}
                    </h2>
                    <p className="mt-0.5 text-sm text-graphite">{item.body}</p>
                    <time
                      dateTime={item.createdAt}
                      className="mt-1 block font-mono text-xs text-graphite/80"
                    >
                      {new Date(item.createdAt).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  </div>
                </div>

                <div className="ml-5 flex items-center gap-3 sm:ml-0">
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="rounded-doc border border-rule px-2.5 py-1 text-xs text-graphite hover:border-ink/50 hover:text-ink"
                    >
                      View
                    </Link>
                  ) : null}
                  <button
                    onClick={() => handleToggleRead(item.id, isRead)}
                    disabled={isPending}
                    aria-label={isRead ? "Mark as unread" : "Mark as read"}
                    className="text-xs text-graphite underline decoration-rule underline-offset-4 hover:text-ink disabled:opacity-50"
                  >
                    {isRead ? "Mark unread" : "Mark read"}
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
