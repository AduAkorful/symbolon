import { Skeleton } from "@/components/Skeleton";
import { PageTitle } from "@/components/ui/Type";

/**
 * Plan 05zd F6: what a page shows inside its frame while a slow section is still reading Arc. The page's own title is drawn at
 * once (it is static text), so when the real content arrives the heading stays where it is.
 */
export function PageLoading({ title, shape }: { title: string; shape: "summary" | "list" }) {
  return (
    <div aria-busy="true" aria-label={`Loading ${title}`}>
      <PageTitle>{title}</PageTitle>
      {shape === "summary" ? (
        <div className="mt-8 space-y-8">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-rule py-6 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-28" />
              </div>
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-doc" />
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-40 w-full rounded-doc" />
          <Skeleton className="h-40 w-full rounded-doc" />
        </div>
      )}
    </div>
  );
}
