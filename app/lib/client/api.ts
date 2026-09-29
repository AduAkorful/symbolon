/** POSTs JSON to one of the app's own routes. Resolves with the parsed answer; rejects with the server's plain-language error. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach Symbolon right now. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(typeof json.error === "string" ? json.error : "Something went wrong. Try again.");
  return json as T;
}
