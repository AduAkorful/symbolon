import type { HTMLAttributes } from "react";

export function Skeleton({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded bg-rule-soft motion-reduce:animate-none ${className}`}
      {...props}
    />
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6 p-6 md:p-10 animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label="Loading content">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <Skeleton className="h-28 w-full rounded-doc" />
        <Skeleton className="h-28 w-full rounded-doc" />
        <Skeleton className="h-28 w-full rounded-doc" />
      </div>
      <Skeleton className="h-64 w-full rounded-doc" />
    </div>
  );
}
