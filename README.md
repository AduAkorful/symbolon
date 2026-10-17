# Symbolon

A two-sided payables network on [Arc](https://docs.arc.io). Vendors sign invoices with a **Seal** (EIP-712). Each
business pays from its own **Vault**, a smart contract that pays a sealed invoice only when the invoice, the order,
delivery and the owner's policy all match. A **Steward** agent decides timing, Early Pay and treasury moves, inside
limits the Vault enforces.

> Status: **Arc testnet**, under active development for the Tameion Agents Hackathon. Not audited. No mainnet deploy.

## What holds, and where it's enforced

- **The model suggests; the contract decides.** No funds move on model output. The Steward's LLM only extracts drafts
  and writes explanations; outcomes come from deterministic code that mirrors the Vault, then a node simulation, then
  the Vault itself.
- **Pay once.** The `InvoiceLedger` keys every invoice by its EIP-712 fingerprint and never credits it beyond its total.
- **Only signed discounts.** A payment differs from the invoice total only by a discount the vendor's Seal signed.
- **Change is slow and loud.** New payout addresses and Seal rotations need the vendor's signature, the owner's
  confirmation and a cooldown. Loosening any rule waits the Vault's delay.
- **Upgrades belong to the business.** Each Vault is upgraded only by its owner after its delay, or by opt-in
  auto-update from published releases.
- **USYC reserve (opt-in):** only for eligible businesses Circle has onboarded and allowlisted; the Vault holds it.

## Layout

| Path | What |
|---|---|
| `contracts/` | Solidity 0.8.36, Foundry: ledger, Vault (UUPS), factory, release registry, lens, reserve logic |
| `packages/seal` | Signed types, canonical invoice documents, fingerprints, signature checks (browser-safe) |
| `packages/chain` | ABIs, deployment registry, Arc config, reads, call builders, log scanning, verify-page check |
| `packages/db` | Postgres schema (Drizzle) |
| `packages/steward` | Policy mirror, matching, timing, treasury planner, decision records and anchoring, model and wallet interfaces |
| `packages/core` | Services: intake, sync, Steward runs, approvals, offers, change control, treasury, screening, exports |

## Arc testnet (chain 5042002)

Registry: [`contracts/deployments/5042002.json`](contracts/deployments/5042002.json). All contracts are verified on the explorer.

| Contract | Address |
|---|---|
| InvoiceLedger | [`0x7EFf84D0715284FA3d793525151b30a05Af45aCE`](https://explorer.testnet.arc.io/address/0x7EFf84D0715284FA3d793525151b30a05Af45aCE) |
| VaultFactory (release 4) | [`0xceB5bb746cDAB3d143C8c5E1A91772509b0Cf1Cf`](https://explorer.testnet.arc.io/address/0xceB5bb746cDAB3d143C8c5E1A91772509b0Cf1Cf) |
| SymbolonVault (release 4 implementation) | [`0xd910EF738d0770774a7d875cD9Ee4fC494C746A1`](https://explorer.testnet.arc.io/address/0xd910EF738d0770774a7d875cD9Ee4fC494C746A1) |
| ReserveLogic | [`0x08F5824164227E0bd07921F026037E4431f32712`](https://explorer.testnet.arc.io/address/0x08F5824164227E0bd07921F026037E4431f32712) |
| LendingLogic | [`0xf844c18b24e8605efE3Df91D50271dEf493CDa96`](https://explorer.testnet.arc.io/address/0xf844c18b24e8605efE3Df91D50271dEf493CDa96) |
| VaultLens | [`0xa964506ecF909F278f266Efd8f24AbaC9447F1CD`](https://explorer.testnet.arc.io/address/0xa964506ecF909F278f266Efd8f24AbaC9447F1CD) |
| ReleaseRegistry | [`0x0C0EF87c88108bd9d306E0C9F48AE733C7AED29e`](https://explorer.testnet.arc.io/address/0x0C0EF87c88108bd9d306E0C9F48AE733C7AED29e) |

Earlier releases (1–3) and their factories are listed in [`contracts/deployments/releases/`](contracts/deployments/releases/); Vaults made by them still work.

## Develop

```bash
pnpm install && pnpm -r build && pnpm -r test
```

```bash
cd contracts && forge test
```

Contract setup, deploys and the live smoke test: [`contracts/README.md`](contracts/README.md). Required credentials:
[`.env.example`](.env.example), [`contracts/.env.example`](contracts/.env.example).
