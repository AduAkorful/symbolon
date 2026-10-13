# SymbolonVault release 4

Adds an optional lending reserve: a Vault's owner may allow one lending vault, chosen by the owner, to hold part of the
Vault's cash. It is off by default. Everything in release 3 is unchanged.

- **One lending vault, owner's choice.** The owner names one ERC-4626 lending vault whose asset is a token the Vault
  already pays in, and a most-allowed share of the Vault's cash (never more than 50%). Allowing it, raising the share,
  or naming a different vault waits the Vault's loosening delay like other loosening changes. Switching it off or
  lowering the share applies at once.
- **The Vault itself holds the shares.** Deposits and withdrawals are made by the Vault, with the Vault as receiver; no
  other address ever holds them. The Vault counts what it received from its own balances and refuses a move that falls
  short of the minimum the caller set, or whose shares are worth clearly less than what was paid for them.
- **Limits that always apply.** A deposit may not leave less than the Vault's operating floor in cash and may not take
  the lending share above the owner's cap. The Steward or the owner may deposit, never while payments are paused. The
  owner can always withdraw, also while paused or with lending switched off; the Steward may only while unpaused.
- **The vault cannot be changed while shares are held**, so shares are never left behind in a vault the Vault no
  longer points at.
- **This is not a bank deposit.** The value of the shares can fall, and a withdrawal depends on the lending vault's own
  liquidity and on its curator's settings. If the lending vault cannot pay out, the Vault keeps the shares and nothing
  else is affected; the owner's cap is what limits the exposure. Nothing in the Vault can make a lending vault pay.
- **Payments are unaffected.** Shares can never be used to pay an invoice or be withdrawn by the Steward. Pay-once,
  policy limits, approvals, the USYC reserve, pause and withdrawals behave as in release 3.
- **Storage is append-only.** Upgrading from release 3 keeps every payee, budget, policy, reserve setting and balance;
  the lending reserve starts off.
- Upgrading is the owner's choice: schedule it, wait the Vault's loosening delay, then apply. New Vaults start on this
  release. A Vault on an earlier release has no lending reserve.
