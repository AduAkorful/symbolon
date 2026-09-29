# Symbolon contracts

Solidity `0.8.36`, Foundry, OpenZeppelin Contracts `5.7.0`.

Core contracts hold state and logic; the periphery serves reads.

| Contract | Layer | Role |
|---|---|---|
| `InvoiceLedger` | Core | Permanent, ownerless record of sealed invoices. `settle` verifies the vendor's Seal signature, delivers the funds to the payout address the Seal signed (locally, or via CCTP V2 to another domain) and records how much of the invoice is paid. An invoice can never be paid beyond its total. |
| `SymbolonVault` | Core | One per business, behind a UUPS proxy. Holds funds and enforces the owner's rules: verified payees, cooldowns on address and Seal changes, per-transaction, per-vendor and budget limits, purchase orders and delivery confirmation, approval thresholds, screening, pause. Any change that loosens a rule is delayed. The Steward can propose payments but cannot change any rule. Upgrades are manual by the owner (scheduled, then applied after the delay), or, only if the owner opts in, published releases apply after the same delay. Exposes `extsload` for reads. |
| `ReserveLogic` | Core (library) | The Vault's USYC reserve moves, run inside the Vault by delegatecall (Aave v3's logic-library pattern), so Circle's Teller sees the Vault as the holder. USYC is only for eligible businesses Circle has onboarded and allowlisted; off by default. |
| `VaultFactory` | Core | Deploys Vault proxies of one implementation. Holds no privileges over them. Each Vault release has its own factory. |
| `ReleaseRegistry` | Core | Symbolon's published Vault implementations, followed only by Vaults whose owner opted in to auto-update. Its owner should be a multisig. |
| `VaultLens` | Periphery | Stateless reader that decodes any Vault's storage into typed views (state, policy, payees, budgets, purchase orders, roles, queued changes, required approval). |

## Setup

`lib/` is not committed. Install the dependencies:

```bash
forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.7.0 OpenZeppelin/openzeppelin-contracts-upgradeable@v5.7.0 --no-git
```

## Test

```bash
forge test
```

Unit, fuzz and invariant tests live in `test/`. Coverage: `forge coverage --ir-minimum`.

If `VaultStorage` changes, regenerate the lens offsets from:

```bash
forge inspect VaultStorageLayout storageLayout
```

## Deployments

`deployments/<chainId>.json` is the deployment registry: every Symbolon address, the external addresses it was
deployed against, the release owner, and `startBlock` (scan logs from here; Arc RPCs reject log queries from block 0).
External addresses live in `deployments/external/<chainId>.json` and are re-checked onchain by the deploy script.

| Network | Registry | Explorer |
|---|---|---|
| Arc testnet (5042002) | [`deployments/5042002.json`](deployments/5042002.json) | https://explorer.testnet.arc.io |

Deploy (key in the gitignored `contracts/.env` as `DEPLOYER_PK`; optional `RELEASE_OWNER`, default the deployer):

```bash
forge script script/Deploy.s.sol --rpc-url arc_testnet
```

```bash
forge script script/Deploy.s.sol --rpc-url arc_testnet --broadcast --slow --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
```

The first command is a dry run and writes nothing; only a broadcast writes the registry.

Ship a new Vault release into an existing deployment (new implementation, factory and lens; publishes it if the
deployer owns the registry; history in `deployments/releases/`). Existing Vaults upgrade only when their owner does:

```bash
RELEASE_NOTES=releases/vault-v2.md forge script script/Release.s.sol --rpc-url arc_testnet --broadcast --slow
```

Forge deploys linked libraries (`ReserveLogic`) through the standard CREATE2 deployer; add their addresses to the
registry from the broadcast's `libraries` entry, and pass `--libraries` when verifying the implementation. The explorer rate-limits
verification: if some contracts fail, verify them one at a time with `forge verify-contract`.

**Arc's USDC can't be simulated by Foundry.** Its ERC-20 moves balances through a native precompile that Foundry's
local EVM doesn't implement, so any script step that moves USDC fails locally. Send those with `cast send` (the node
executes them), as `script/Smoke.s.sol` does. The live smoke test's steps are listed at the top of that file.
