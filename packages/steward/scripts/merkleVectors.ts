// Generates vectors/merkle.json: decision hashes, the tree root and every proof, for
// contracts/test/DecisionMerkle.t.sol to verify with OpenZeppelin's MerkleProof. Run: pnpm --filter @symbolon/steward vectors
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { keccak256, stringToBytes } from "viem";

import { buildTree, proofFor } from "../src/records.js";

export function buildMerkleVectors() {
  return [1, 2, 3, 5, 8, 13].map((n) => {
    const leaves = Array.from({ length: n }, (_, i) => keccak256(stringToBytes(`symbolon.vectors.decision.${n}.${i}`)));
    const tree = buildTree(leaves);
    return { n, root: tree.root, decisions: leaves, proofs: leaves.map((_, i) => proofFor(tree, i)) };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = fileURLToPath(new URL("../vectors/merkle.json", import.meta.url));
  writeFileSync(out, `${JSON.stringify({ description: "Decision anchoring vectors. Generated; do not edit.", trees: buildMerkleVectors() }, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
