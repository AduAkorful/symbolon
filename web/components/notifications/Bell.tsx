import Link from "next/link";

export function Bell({ unreadCount }: { unreadCount: number }) {
  const displayCount = unreadCount > 99 ? "99+" : unreadCount.toString();

  return (
    <Link
      href="/notifications"
      aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      className="relative flex h-11 w-11 items-center justify-center rounded-doc sm:h-10 sm:w-10 text-graphite transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-seal"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {unreadCount > 0 ? (
        <span
          className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-seal px-1 text-xs font-semibold leading-none text-paper"
        >
          {displayCount}
        </span>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {unreadCount > 0 ? `${unreadCount} unread notifications` : "No unread notifications"}
      </span>
    </Link>
  );
}
