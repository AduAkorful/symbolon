import { concat, encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";

import { canonicalJson } from "@symbolon/seal";

/**
 * A decision record (spec §5.5): what the Steward knew, what it considered, the rule it applied and what happened,
 * including declined and refused actions. Amounts are strings of raw units.
 */
export interface DecisionRecord {
  version: 1;
  kind: string;
  business: string;
  subject?: string;
  at: string;
  mode: "shadow" | "assist" | "auto";
  inputs: Record<string, unknown>;
  options: Record<string, unknown>[];
  rule: string;
  outcome: string;
  explanation?: string;
}

/** bigint → decimal string, recursively, so records serialise canonically */
export function toRecordValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toRecordValue);
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toRecordValue(v)]));
  }
  return value;
}

/** The record's canonical bytes and hash (`decisionHash` passed to the Vault with the transaction) */
export function hashRecord(record: DecisionRecord): { canonical: string; hash: Hex } {
  const canonical = canonicalJson(toRecordValue(record));
  return { canonical, hash: keccak256(stringToBytes(canonical)) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Anchoring: an OpenZeppelin-compatible Merkle tree (double-hashed leaves, sorted pairs), so any decision can be proven
// against the root the Vault emitted in `DecisionsAnchored(root, count)` with `MerkleProof.verify`.
// ---------------------------------------------------------------------------------------------------------------------

export function leafOf(decisionHash: Hex): Hex {
  return keccak256(keccak256(encodeAbiParameters([{ type: "bytes32" }], [decisionHash])));
}

function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() < b.toLowerCase() ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

export interface MerkleTree {
  root: Hex;
  layers: Hex[][];
}

export function buildTree(decisionHashes: readonly Hex[]): MerkleTree {
  if (decisionHashes.length === 0) throw new Error("nothing to anchor");
  let layer = decisionHashes.map(leafOf);
  const layers: Hex[][] = [layer];
  while (layer.length > 1) {
    const next: Hex[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i]!;
      const right = layer[i + 1];
      next.push(right === undefined ? left : hashPair(left, right));
    }
    layer = next;
    layers.push(layer);
  }
  return { root: layer[0]!, layers };
}

export function proofFor(tree: MerkleTree, index: number): Hex[] {
  const proof: Hex[] = [];
  let i = index;
  for (const layer of tree.layers.slice(0, -1)) {
    const sibling = i % 2 === 0 ? layer[i + 1] : layer[i - 1];
    if (sibling !== undefined) proof.push(sibling);
    i = Math.floor(i / 2);
  }
  return proof;
}

/** `MerkleProof.verify(proof, root, leaf)` */
export function verifyProof(proof: readonly Hex[], root: Hex, decisionHash: Hex): boolean {
  return proof.reduce<Hex>((acc, sibling) => hashPair(acc, sibling), leafOf(decisionHash)).toLowerCase() === root.toLowerCase();
}
