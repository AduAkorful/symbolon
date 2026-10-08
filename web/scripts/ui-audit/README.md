# UI audit (plan 05zb)

Renders the app's pages in headless Chrome at several widths, injects `harness.js` and fails on: horizontal overflow, an address
broken across lines, a boxed element whose text touches its edge, text under 11.5 px, contrast under WCAG AA, unnamed
controls, inputs with no label, off-screen text, dead links, a missing or doubled `<main>`, and (with `--dialogs`) a dialog
with a nested frame, no title, no inner padding, or one that Escape does not close.

```
# 1. stop the dev server (PGlite is a single-process database), then seed the local database and write tokens.json
pnpm --filter @symbolon/app exec tsx scripts/ui-audit/seed.mts --vault 0x…   # a Vault that exists on the configured chain
# 2. start the app, then audit
pnpm --filter @symbolon/app dev
node scripts/ui-audit/run.mjs --tokens scripts/ui-audit/tokens.json --dialogs --widths 1440,375
```

`seed.mts` makes an owner with a business on the Vault you give it, a team, a vendor with a Seal and verified payee, 23 sealed
invoices (a long vendor name, a long invoice number, EURC, every status), a stalled Steward run and notifications. Run again, it
keeps that data and only issues new sessions. It only writes to a local PGlite folder. The pages read the Vault and the ledger
live, so the audit needs the configured Arc RPC to answer; that is why it is not in CI yet (see plan 05zb, section G).

`tokens.json` (gitignored) holds session tokens for a seeded owner and vendor; sessions are created directly in the local
database, the audit never goes through Privy. Screenshots and `results.json` go to `scripts/ui-audit/out/` (gitignored).
It only ever targets a local development server.
