/** Circle's CCTP V2 attestation API (sandbox for testnets). Public; no key. */
export const IRIS_API = { testnet: "https://iris-api-sandbox.circle.com", mainnet: "https://iris-api.circle.com" } as const;

/** The finality the ledger requests on every burn (`minFinalityThreshold` 2000 = standard) */
export const STANDARD_FINALITY = 2_000;

export interface CctpFee {
  finalityThreshold: number;
  /** Minimum fee in bps of the burned amount */
  minimumFeeBps: number;
}

export async function cctpFees(sourceDomain: number, destinationDomain: number, network: keyof typeof IRIS_API, fetcher: typeof fetch = fetch): Promise<CctpFee[]> {
  const res = await fetcher(`${IRIS_API[network]}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}`);
  if (!res.ok) throw new Error(`CCTP fee lookup failed: ${res.status}`);
  const body = (await res.json()) as { finalityThreshold: number; minimumFee: number }[];
  return body.map((f) => ({ finalityThreshold: f.finalityThreshold, minimumFeeBps: f.minimumFee }));
}

/**
 * `maxFee` for a standard-finality payout of `paid`: Circle's current minimum, rounded up, plus `headroomBps` in case
 * the fee moves before the burn. The Vault separately caps it at the owner's `maxBridgeFee`.
 */
export async function cctpMaxFee(
  paid: bigint,
  sourceDomain: number,
  destinationDomain: number,
  network: keyof typeof IRIS_API,
  opts: { headroomBps?: number; fetcher?: typeof fetch } = {},
): Promise<bigint> {
  const fees = await cctpFees(sourceDomain, destinationDomain, network, opts.fetcher);
  const standard = fees.find((f) => f.finalityThreshold === STANDARD_FINALITY);
  if (!standard) throw new Error("no standard-finality fee quoted");
  const bps = BigInt(Math.ceil(standard.minimumFeeBps * 100)) + BigInt((opts.headroomBps ?? 0) * 100);
  return (paid * bps + 1_000_000n - 1n) / 1_000_000n;
}
