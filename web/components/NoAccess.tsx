import Link from "next/link";

export function NoAccess({
  title = "Access restricted",
  message = "You don’t have access to this. If you should, ask the business owner to update your role.",
  homeHref = "/business",
  homeLabel = "Return to dashboard",
}: {
  title?: string;
  message?: string;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="mx-auto max-w-[560px] px-6 py-20 text-center md:px-10">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-graphite">Permission Required</p>
      <h1 className="mt-4 font-display text-3xl leading-tight md:text-4xl">{title}</h1>
      <p className="mt-3 text-graphite leading-relaxed">{message}</p>
      <div className="mt-8 flex justify-center">
        <Link
          href={homeHref}
          className="rounded-doc bg-ink px-5 py-2.5 font-medium text-paper hover:bg-ink/90 focus:outline-none focus:ring-2 focus:ring-seal"
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
