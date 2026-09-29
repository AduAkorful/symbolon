/**
 * Where to go after signing in. Only a path on this site is allowed, so a sign-in link can't be used to send someone
 * to another address afterwards (an open redirect).
 */
export function safeNext(value: string | string[] | undefined, fallback = "/signin"): string {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || v.length > 300) return fallback;
  if (!v.startsWith("/") || v.startsWith("//") || v.includes("\\") || /[\u0000-\u001f]/.test(v)) return fallback;
  return v;
}
