/** What the server said when it refused or couldn't finish: its plain-language message, the HTTP status and, when it gave one, a reason code */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** POSTs JSON to one of the app's own routes. Resolves with the parsed answer; rejects with the server's plain-language error. */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new Error("Can't reach Symbolon right now. Check your connection and try again.");
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      typeof json.error === "string" ? json.error : "Something went wrong. Try again.",
      res.status,
      typeof json.code === "string" ? json.code : undefined,
    );
  }
  return json as T;
}

/** True when the transaction was sent and Arc just hasn't shown it to the server yet (or the network was busy): asking again is right */
export function isStillConfirming(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "tx_pending" || error.code === "busy");
}

/**
 * Tells the server about a transaction the person's wallet has already sent (plan 05zj A, SYM-03). The server waits for the receipt
 * itself; when Arc still hasn't shown it, this asks again a few times before giving up. Every record route is idempotent by hash,
 * so asking again is safe. Anything other than "still confirming" is thrown at once.
 */
export async function postRecord<T = Record<string, unknown>>(
  url: string,
  body: unknown,
  opts: { tries?: number; everyMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const tries = opts.tries ?? 6;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return await postJson<T>(url, body);
    } catch (e) {
      if (!isStillConfirming(e) || attempt >= tries) throw e;
      await sleep(opts.everyMs ?? 2_000);
    }
  }
}
