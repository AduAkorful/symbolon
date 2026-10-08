import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { Eyebrow, PageTitle } from "@/components/ui/Type";

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
      <Eyebrow>Permission required</Eyebrow>
      <PageTitle className="mt-4">{title}</PageTitle>
      <p className="mt-3 text-graphite leading-relaxed">{message}</p>
      <div className="mt-8 flex justify-center">
        <Link
          href={homeHref}
          className={buttonClass()}
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
