# @symbolon/seal

What a Seal signs, byte-identical to the contracts: EIP-712 types, the canonical invoice document, fingerprints,
signature checks (ECDSA first, then ERC-1271), amounts and Early Pay quotes. Browser-safe (viem + zod only).

```ts
import { completeTotals, sealInvoice, verifySealedInvoice } from "@symbolon/seal";

const document = completeTotals(draft);                    // composer input -> canonical document
const { sealed, fingerprint } = await sealInvoice({ signer, chainId, ledger, document });
const check = await verifySealedInvoice(sealed, { client, expected: { chainId, ledger } });
```

- **Canonical document** (`symbolon.invoice.v1`): strict schema, NFC text without control or bidi characters,
  lowercase addresses, amounts with exactly the token's decimals, RFC 8785-style JSON.
  `documentHash = keccak256(utf8(canonicalJson))`.
- **The signed `Invoice` is derived from the document** (`toInvoice`), never entered separately; documents that
  don't reconcile to the last unit are refused.
- **Verification recomputes everything** from the document; pin `expected` to Symbolon's deployment.

## Commands

| | |
|---|---|
| `pnpm test` | Vitest suite, including the known-vector drift check |
| `pnpm typecheck` / `pnpm build` | TypeScript checks / `dist/` |
| `pnpm vectors` | Regenerate `vectors/v1.json` (only after an intentional change to what is signed) |

The same vectors are checked by `contracts/test/SealVectors.t.sol`, which also settles the TypeScript-signed
invoices on the real `InvoiceLedger`. Both suites must pass after any change here or in `SealTypes.sol`.
