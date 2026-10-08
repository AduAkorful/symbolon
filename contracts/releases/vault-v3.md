# SymbolonVault release 3

Lets a Vault receive USDC sent straight from a wallet, and stops a purchase order from being reopened. Everything in
release 2 is unchanged.

- **Fund a Vault from any wallet.** On Arc, USDC is both the network's own coin and a token, two views of one balance.
  A wallet's Send screen sends the coin, which earlier releases refused: the transaction failed and only the network fee
  was lost. From this release the Vault accepts it. Anyone can send USDC to the Vault's address, also while payments
  are paused. The Vault records who sent it and how much (in the coin's 18 decimals, not the token's 6). Receiving
  changes no setting and gives the sender no right over the Vault.
- **A purchase order is opened once.** Opening an order with a reference that already exists, open or closed, now fails
  instead of silently resetting what remains on it. Close it and use a new reference.
- Nothing else changes: payments, limits, approvals, the reserve, pause and withdrawals behave as in release 2. Storage
  is untouched, so upgrading from release 2 keeps every payee, budget, policy and balance.
- Upgrading is the owner's choice: schedule it, wait the Vault's loosening delay, then apply. New Vaults start on this
  release. A Vault still on an earlier release keeps refusing a wallet's direct USDC send; fund it with Add funds in
  the app, or upgrade first.
