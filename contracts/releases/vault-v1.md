# SymbolonVault release 1

The first Vault implementation (plans 01, 01a, 01b).

- One Vault per business behind an ERC-1967 proxy (UUPS). Upgrades belong to the Vault's owner: scheduled, then
  applied after the Vault's loosening delay. Auto-update is off unless the owner opts in.
- Pays Seal-signed invoices through the immutable `InvoiceLedger` only when payee, payout, purchase order, delivery,
  budgets, caps, screening and approvals all hold. Loosening changes are delayed; tightening is immediate.
- The Steward can pay within those rules and nothing else: it cannot withdraw, change policy, payees or its own role.
- State lives in ERC-7201 storage (`symbolon.storage.SymbolonVault`); reads go through `VaultLens` via `extsload`.
