"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { postJson } from "@/lib/client/api";
import type { FormattedNotification } from "@/lib/server/notifications";
import { formatDateTime } from "@/lib/format";
import { Button, LinkButton } from "@/components/ui/button";
import { EmptyState, InlineError } from "@/components/ui/States";
import { Lead, PageTitle } from "@/components/ui/Type";

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
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-rule pb-6">
        <div className="min-w-0">
          <PageTitle>Notifications</PageTitle>
          <Lead className="mt-3">Notices from your businesses and your Seal. They appear here; email and push delivery aren’t available yet.</Lead>
        </div>
        {unreadCount > 0 ? (
          <Button variant="secondary" busy={isPending} onClick={handleMarkAllRead}>Mark all as read</Button>
        ) : null}
      </div>

      {problem ? <InlineError>{problem}</InlineError> : null}

      {items.length === 0 ? (
        <EmptyState title="Nothing needs you">When an invoice needs approval or a payment settles on Arc, you’ll see it here.</EmptyState>
      ) : (
        <ol className="divide-y divide-rule-soft border-y border-rule" aria-label="Notifications">
          {items.map((item) => {
            const isRead = item.readAt !== null;
            return (
              <li key={item.id} className={`flex flex-col gap-3 px-1 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6 ${isRead ? "" : "bg-paper-raised/40"}`}>
                <div className="flex min-w-0 items-start gap-3">
                  <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${isRead ? "bg-transparent" : "bg-seal"}`} role="img" aria-label={isRead ? "Read" : "Unread"} />
                  <div className="min-w-0">
                    <h2 className={`${isRead ? "text-graphite" : "font-medium text-ink"}`}>
                      {item.href ? <Link href={item.href} className="hover:underline">{item.title}</Link> : item.title}
                    </h2>
                    <p className="mt-0.5 text-sm text-graphite">{item.body}</p>
                    <time dateTime={item.createdAt} className="mt-1 block text-sm text-graphite">{formatDateTime(item.createdAt)}</time>
                  </div>
                </div>

                <div className="ml-5 flex shrink-0 items-center gap-2 sm:ml-0">
                  {item.href ? <LinkButton href={item.href} variant="secondary" size="sm">View</LinkButton> : null}
                  <Button variant="quiet" size="sm" disabled={isPending} aria-label={isRead ? "Mark as unread" : "Mark as read"} onClick={() => handleToggleRead(item.id, isRead)}>
                    {isRead ? "Mark unread" : "Mark read"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
