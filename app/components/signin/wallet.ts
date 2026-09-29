/** The slice of an EIP-1193 provider the signers use (Privy hands these back for the person's wallets) */
export interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

/** The person closed the wallet's request (EIP-1193 code 4001), which is a choice, not an error */
export const isUserRejection = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: number }).code === 4001;
