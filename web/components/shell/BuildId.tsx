import { buildId } from "@/lib/build-id";

/** A small "Build 03cc28d" line (QA BUILD-1); renders nothing when the build has no commit id */
export function BuildId({ className = "" }: { className?: string }) {
  const id = buildId({ NEXT_PUBLIC_BUILD_ID: process.env.NEXT_PUBLIC_BUILD_ID });
  if (!id) return null;
  return <p className={`font-mono text-xs text-graphite ${className}`}>Build {id}</p>;
}
