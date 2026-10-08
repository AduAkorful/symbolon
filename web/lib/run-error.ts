/**
 * What a person is told when a Steward pass failed. The stored reason is whatever the failure said (for a read that Arc's public
 * network could not answer, a library's own text with its version), which is for the log and not for a screen. Messages the app
 * wrote itself pass through; anything that looks like a library's or a node's text becomes a plain sentence.
 */
const TECHNICAL = /\bviem\b|\bRPC\b|Details:|Version:|\bHTTP\b|\bat \w+ \(|0x[0-9a-fA-F]{64}|ECONN|ETIMEDOUT|fetch failed|stack/i;

export function plainRunError(raw: string | null | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return "This check didn't finish.";
  if (/rate limit|busy or resting|\b429\b|too many requests/i.test(text)) return "Arc's public network was busy, so this check didn't finish. The Steward tries again on its own.";
  if (/timed out|timeout|deadline|ETIMEDOUT/i.test(text)) return "Arc took too long to answer, so this check didn't finish. The Steward tries again on its own.";
  if (/lease expired/i.test(text)) return "The previous check was interrupted before it finished.";
  if (TECHNICAL.test(text)) return "This check didn't finish because Arc couldn't be read. The Steward tries again on its own.";
  return text;
}
