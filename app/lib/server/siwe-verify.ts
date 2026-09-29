import "server-only";
import { getClient } from "./chain";
import type { SignatureVerifier } from "./siwe";

/** viem's verifyMessage handles a plain key, a deployed smart-contract wallet (ERC-1271) and an undeployed one (ERC-6492) */
export const verifyOnChain: SignatureVerifier = ({ address, message, signature }) => getClient().verifyMessage({ address, message, signature });
