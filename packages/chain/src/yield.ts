import { parseAbi, type Address, type PublicClient } from "viem";

const ORACLE_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);
const TELLER_ORACLE_ABI = parseAbi(["function oracle() view returns (address)"]);
const YEAR = 365n * 86_400n;

export interface ReserveYield {
  /** Annualized, in bps, from the oracle's own price history (simple, not compounded) */
  bps: number;
  fromPrice: bigint;
  toPrice: bigint;
  fromTime: bigint;
  toTime: bigint;
}

/**
 * The USYC reserve's realised yield over the last `rounds` oracle updates (daily on Arc testnet), read from the
 * Teller's price oracle. Never an assumed or advertised rate: spec claims discipline.
 */
export async function reserveYield(client: PublicClient, teller: Address, rounds = 30): Promise<ReserveYield> {
  const oracle = await client.readContract({ address: teller, abi: TELLER_ORACLE_ABI, functionName: "oracle" });
  const [latestRound, toPrice, , toTime] = await client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "latestRoundData" });
  const fromRound = latestRound > BigInt(rounds) ? latestRound - BigInt(rounds) : 1n;
  const [, fromPrice, , fromTime] = await client.readContract({ address: oracle, abi: ORACLE_ABI, functionName: "getRoundData", args: [fromRound] });
  if (fromPrice <= 0n || toPrice <= 0n || toTime <= fromTime) throw new Error("oracle history is unusable");
  const bps = ((toPrice - fromPrice) * 10_000n * YEAR) / (fromPrice * (toTime - fromTime));
  return { bps: Number(bps < 0n ? 0n : bps), fromPrice, toPrice, fromTime, toTime };
}
