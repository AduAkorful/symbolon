/**
 * The short commit this build was made from (QA BUILD-1), so a screenshot names its build. Vercel provides
 * VERCEL_GIT_COMMIT_SHA at build time; next.config.ts copies it (or the local git commit) into NEXT_PUBLIC_BUILD_ID.
 */
export function buildId(env: Record<string, string | undefined> = process.env): string | null {
  const sha = env.NEXT_PUBLIC_BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || "";
  return /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null;
}
