# SymbolonVault release 2

Adds an optional USYC reserve (plan 04). Everything in release 1 is unchanged.

- USYC is available only to eligible businesses Circle has onboarded and allowlisted (Circle: not U.S. Persons under
  Regulation S; KYC/AML; wallet allowlisting). The Vault itself is the allowlisted address and holds the USYC; nothing
  is pooled across businesses.
- Off by default. The owner sets a reserve policy: on/off, the largest share of the Vault that may sit in USYC, and
  the USDC that must always stay available. Switching it on, raising the share or lowering the floor waits the
  Vault's loosening delay, and switching it on requires Circle's allowlisting to already be in place.
- The Steward or owner can move cash into USYC and back, always with the Vault as the receiver, a minimum-out bound
  measured by the Vault's own balances, and the policy re-checked after every subscription. The owner can always
  redeem back to cash, even while paused or with the reserve switched off.
- USYC can never be used to pay an invoice.
- Reserve logic lives in the external `ReserveLogic` library (runs as the Vault); reads are in `VaultLens`
  (`getReservePolicy`, `reserveStatus`).
- Storage is append-only: one new field (`reserve`) after all release-1 state. Upgrading from release 1 keeps every
  payee, budget, policy and balance; the reserve starts off.
