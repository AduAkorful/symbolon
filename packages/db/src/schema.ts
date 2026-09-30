import { sql } from "drizzle-orm";
import {
  bigint,

  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Conventions: addresses and hashes are lowercase 0x text (checked); token amounts are raw units in numeric(78,0)
// (bigint in TS, never floats); rows that mirror chain state record the block they were read at and are only ever
// written by sync. The chain is the source of truth for money.

const ADDRESS = "^0x[0-9a-f]{40}$";
const HASH = "^0x[0-9a-f]{64}$";

const address = (name: string) => text(name);
const hash = (name: string) => text(name);
const amount = (name: string) => numeric(name, { precision: 78, scale: 0, mode: "bigint" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------------------------------------------------
// People and organisations
// ---------------------------------------------------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for someone who signed in with their own wallet and hasn't added one yet (plan 05g, S4) */
    email: text("email"),
    /** The user's wallet (embedded or their own) */
    wallet: address("wallet"),
    /** Privy's id for this person: the stable key for sign-in. Accounts are never found or merged by email or wallet (plan 05k, P3). */
    privyUserId: text("privy_user_id"),
    /** Optional display name (1..80 chars, only a label; plan 05u N7) */
    displayName: text("display_name"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    uniqueIndex("users_wallet_key").on(t.wallet),
    uniqueIndex("users_privy_user_key").on(t.privyUserId),
    check("users_email_lower", sql`${t.email} = lower(${t.email})`),
    check("users_wallet_format", sql`${t.wallet} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("users_display_name_len", sql`${t.displayName} is null or (length(${t.displayName}) >= 1 and length(${t.displayName}) <= 80)`),
  ],
);

export const sessionMethod = pgEnum("session_method", ["privy"]);

/** Server-side sessions: only the SHA-256 of the cookie's token is stored, so a copied row can't be replayed (plan 05g, S1) */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    method: sessionMethod("method").notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_key").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** A vendor's public identity. The Seal address is the key the vendor signs invoices with. */
export const seals = pgTable(
  "seals",
  {
    address: address("address").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name"),
    website: text("website"),
    /** Where new invoices pay out by default; null = the Seal's own address. Each invoice carries the address it was signed with. */
    payoutAddress: address("payout_address"),
    /** Set only after the vendor proves control of the domain (spec §5.1); a badge, never per-business verification */
    verifiedDomain: text("verified_domain"),
    /** Replaced by a newer Seal through a signed rotation */
    rotatedTo: address("rotated_to"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("seals_handle_key").on(t.handle),
    check("seals_address_format", sql`${t.address} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("seals_payout_format", sql`${t.payoutAddress} is null or ${t.payoutAddress} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("seals_handle_format", sql`${t.handle} ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'`),
  ],
);

/** The businesses a vendor invoices: a name plus a Vault address or an email (plan 05i, V5). Not a directory of Symbolon businesses. */
export const vendorClients = pgTable(
  "vendor_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seal: address("seal").notNull().references(() => seals.address),
    name: text("name").notNull(),
    email: text("email"),
    vault: address("vault"),
    createdAt: createdAt(),
  },
  (t) => [
    index("vendor_clients_seal").on(t.seal),
    uniqueIndex("vendor_clients_seal_vault").on(t.seal, t.vault),
    uniqueIndex("vendor_clients_seal_email").on(t.seal, t.email),
    check("vendor_clients_identifier", sql`${t.vault} is not null or ${t.email} is not null`),
    check("vendor_clients_vault_format", sql`${t.vault} is null or ${t.vault} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("vendor_clients_email_lowercase", sql`${t.email} is null or ${t.email} = lower(${t.email})`),
  ],
);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    chainId: integer("chain_id").notNull(),
    /** Null until the Vault is created onchain */
    vault: address("vault"),
    /** The business's Steward wallet (developer-controlled); null until provisioned */
    stewardWallet: address("steward_wallet"),
    /** How far the Steward may act: shadow (records only), assist (asks), auto (acts within the Vault's rules) */
    stewardMode: text("steward_mode").notNull().default("shadow"),
    /** Early Pay program settings; null means disabled */
    earlyPay: jsonb("early_pay").$type<{ enabled: boolean; minSpreadBps: number; cashCapBps: number } | null>(),
    /** Block number where the Vault was deployed (sync start point) */
    vaultBlock: bigint("vault_block", { mode: "bigint" }),
    /** Treasury buffer days: cash reserved for upcoming obligations (1..90, null = default 30) (plan 05r T9) */
    bufferDays: integer("buffer_days"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("businesses_vault_key").on(t.chainId, t.vault),
    check("businesses_vault_format", sql`${t.vault} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("businesses_steward_mode", sql`${t.stewardMode} in ('shadow', 'assist', 'auto')`),
    check("businesses_vault_block_check", sql`${t.vaultBlock} is null or ${t.vaultBlock} >= 0`),
    check("businesses_buffer_days_check", sql`${t.bufferDays} is null or (${t.bufferDays} >= 1 and ${t.bufferDays} <= 90)`),
  ],
);

export const memberRole = pgEnum("member_role", ["owner", "approver", "requester", "viewer"]);

export const members = pgTable(
  "members",
  {
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    role: memberRole("role").notNull(),
    /** Budgets an approver may approve for (bytes32 ids); empty means the operating budget */
    budgets: jsonb("budgets").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.userId] })],
);

// ---------------------------------------------------------------------------------------------------------------------
// Relationships: a vendor as a payee of one business. Verification is per relationship (spec §5.1).
// ---------------------------------------------------------------------------------------------------------------------

export const payeeStatus = pgEnum("payee_status", ["invited", "pending_verification", "verified", "blocked", "retired"]);

export const payees = pgTable(
  "payees",
  {
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    seal: address("seal").notNull(),
    status: payeeStatus("status").notNull().default("pending_verification"),
    /** How the first-contact check was done (call-back number, known contact); required before `verified` */
    verificationMethod: text("verification_method"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.seal] }),
    check("payees_seal_format", sql`${t.seal} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check(
      "payees_verified_has_method",
      sql`${t.status} <> 'verified' or (${t.verificationMethod} is not null and ${t.verifiedAt} is not null)`,
    ),
  ],
);

/** Counterparty compliance screenings (spec §12, plan 05s K1). Rows are never updated. */
export const screenings = pgTable(
  "screenings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    seal: address("seal").notNull(),
    address: address("address").notNull(),
    risk: smallint("risk").notNull(),
    result: text("result").notNull(),
    ruleName: text("rule_name"),
    actions: text("actions").array().notNull().default(sql`'{}'`),
    categories: text("categories").array().notNull().default(sql`'{}'`),
    provider: text("provider").notNull(),
    screenedAt: timestamp("screened_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index("screenings_business_seal_idx").on(t.businessId, t.seal),
    index("screenings_business_screened_idx").on(t.businessId, t.screenedAt),
    check("screenings_seal_format", sql`${t.seal} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("screenings_address_format", sql`${t.address} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("screenings_risk_range", sql`${t.risk} between 0 and 3`),
    check("screenings_result_check", sql`${t.result} in ('APPROVED', 'DENIED')`),
  ],
);

export const verificationMethod = pgEnum("vendor_verification_method", ["invitation", "code"]);
export const verificationStatus = pgEnum("vendor_verification_status", ["open", "awaiting_second", "verified", "cancelled", "expired"]);

/** Single-use bearer invitations; only the token hash is persisted. */
export const vendorInvitations = pgTable(
  "vendor_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    vendorName: text("vendor_name").notNull(),
    contactNote: text("contact_note").notNull(),
    tokenHash: text("token_hash").notNull(),
    terms: jsonb("terms").$type<{ monthlyCap: string; requirePo: boolean; requireDelivery: boolean } | null>(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedSeal: address("accepted_seal"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("vendor_invitations_token_hash_key").on(t.tokenHash),
    index("vendor_invitations_business_idx").on(t.businessId, t.createdAt),
    check("vendor_invitations_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("vendor_invitations_seal_format", sql`${t.acceptedSeal} is null or ${t.acceptedSeal} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("vendor_invitations_single_terminal_state", sql`not (${t.acceptedAt} is not null and ${t.revokedAt} is not null)`),
  ],
);

/** Per-business first-contact checks. Codes are HMACed, attempts and second-person approval are durable. */
export const vendorVerifications = pgTable(
  "vendor_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    seal: address("seal"),
    method: verificationMethod("method").notNull(),
    status: verificationStatus("status").notNull().default("open"),
    raisedBy: uuid("raised_by").notNull().references(() => users.id),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    secondBy: uuid("second_by").references(() => users.id),
    codeHmac: text("code_hmac"),
    codeCiphertext: text("code_ciphertext"),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    contacted: text("contacted"),
    channel: text("channel"),
    cap: amount("cap"),
    invoiceFingerprint: hash("invoice_fingerprint"),
    invitationId: uuid("invitation_id").references(() => vendorInvitations.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("vendor_verifications_business_idx").on(t.businessId, t.createdAt),
    uniqueIndex("vendor_verifications_open_code_key").on(t.businessId, t.seal).where(sql`${t.method} = 'code' and ${t.status} in ('open', 'awaiting_second')`),
    check("vendor_verifications_seal_format", sql`${t.seal} is null or ${t.seal} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("vendor_verifications_fingerprint_format", sql`${t.invoiceFingerprint} is null or ${t.invoiceFingerprint} ~ ${sql.raw(`'${HASH}'`)}`),
    check("vendor_verifications_nonnegative_attempts", sql`${t.attempts} between 0 and 5`),
    check("vendor_verifications_second_is_distinct", sql`${t.secondBy} is null or (${t.secondBy} <> ${t.raisedBy} and (${t.confirmedBy} is null or ${t.secondBy} <> ${t.confirmedBy}))`),
    check("vendor_verifications_code_fields", sql`${t.method} <> 'code' or (${t.codeHmac} is not null and ${t.codeCiphertext} is not null and ${t.expiresAt} is not null and ${t.seal} is not null)`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------------
// Invoices, orders, deliveries
// ---------------------------------------------------------------------------------------------------------------------

export const invoiceStatus = pgEnum("invoice_status", [
  "received", // stored, not yet checked
  "rejected", // failed verification (issues say why); never payable
  "verified", // genuine, reconciles, awaiting matching/decision
  "held", // the Steward or a rule is holding it (reason in decisions)
  "awaiting_approval",
  "scheduled",
  "partially_paid",
  "paid",
  "cancelled",
]);

export const invoices = pgTable(
  "invoices",
  {
    fingerprint: hash("fingerprint").primaryKey(),
    chainId: integer("chain_id").notNull(),
    ledger: address("ledger").notNull(),
    seal: address("seal").notNull(),
    /** The payer business if known (matched by payerRef or by the recipient) */
    businessId: uuid("business_id").references(() => businesses.id),
    payerRef: hash("payer_ref").notNull(),
    invoiceNumber: text("invoice_number").notNull(),
    token: address("token").notNull(),
    total: amount("total").notNull(),
    dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
    /** From the sealed invoice; used for near-duplicate screening */
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    poRef: hash("po_ref"),
    replaces: hash("replaces"),
    /** The sealed envelope exactly as received (canonical JSON), kept for re-verification and the verify page */
    envelope: text("envelope").notNull(),
    status: invoiceStatus("status").notNull().default("received"),
    issues: jsonb("issues").$type<{ code: string; path: string; message: string }[]>().notNull().default([]),
    /** Mirrored from the ledger by sync */
    credited: amount("credited").notNull().default(sql`0`),
    syncedBlock: bigint("synced_block", { mode: "bigint" }),
    source: text("source").notNull(),
    /**
     * Who placed the hold. `steward` = the Steward holds it and can reconsider each run.
     * `human` = a delivery rejection; never released by a Steward re-run — only by a delivery confirmation.
     * Null when status is not `held`.
     */
    holdSource: text("hold_source"),
    receivedAt: createdAt(),
  },
  (t) => [
    index("invoices_business_status").on(t.businessId, t.status),
    index("invoices_seal").on(t.seal),
    index("invoices_seal_number").on(t.seal, t.invoiceNumber),
    check("invoices_fingerprint_format", sql`${t.fingerprint} ~ ${sql.raw(`'${HASH}'`)}`),
    check("invoices_seal_format", sql`${t.seal} ~ ${sql.raw(`'${ADDRESS}'`)}`),
    check("invoices_source", sql`${t.source} in ('link', 'email', 'upload', 'api', 'recurring')`),
    check("invoices_amounts", sql`${t.total} > 0 and ${t.credited} >= 0 and ${t.credited} <= ${t.total}`),
    check("invoices_hold_source", sql`${t.holdSource} is null or ${t.holdSource} in ('steward', 'human')`),
    check("invoices_hold_source_with_status", sql`${t.status} = 'held' or ${t.holdSource} is null`),
  ],
);

export const unsignedBills = pgTable(
  "unsigned_bills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    fileName: text("file_name").notNull(),
    fileSha256: text("file_sha256").notNull(),
    /** The model's extracted fields, retained as data for the refusal view; never used as a payment instruction. */
    extraction: jsonb("extraction").$type<Record<string, unknown>>().notNull(),
    assessment: jsonb("assessment").$type<Record<string, unknown>>().notNull(),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("unsigned_bills_business_file").on(t.businessId, t.fileSha256),
    index("unsigned_bills_business_status").on(t.businessId, t.status),
    check("unsigned_bills_file_hash_format", sql`${t.fileSha256} ~ ${sql.raw(`'${HASH}'`)}`),
    check("unsigned_bills_status", sql`${t.status} in ('open', 'invited', 'fraud', 'dismissed')`),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    /** keccak256 of the PO number (`poRef()` in @symbolon/seal), the Vault's key */
    poRef: hash("po_ref").notNull(),
    poNumber: text("po_number").notNull(),
    seal: address("seal").notNull(),
    budget: hash("budget").notNull(),
    amount: amount("amount").notNull(),
    description: text("description"),
    kind: text("kind").notNull().default("one_off"),
    releaseAfter: timestamp("release_after", { withTimezone: true }),
    /** Transaction hash that opened this PO onchain; null for rows written before 05n */
    openTx: hash("open_tx"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedTx: hash("closed_tx"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.poRef] }),
    check("purchase_orders_kind", sql`${t.kind} in ('one_off', 'recurring', 'milestone')`),
    check("purchase_orders_open_tx_format", sql`${t.openTx} is null or ${t.openTx} ~ ${sql.raw(`'${HASH}'`)}`),
    check("purchase_orders_closed_tx_format", sql`${t.closedTx} is null or ${t.closedTx} ~ ${sql.raw(`'${HASH}'`)}`),
    check("purchase_orders_closed_consistent", sql`(${t.closedAt} is null) = (${t.closedTx} is null)`),
  ],
);

export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    fingerprint: hash("fingerprint").notNull(),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    /** e.g. a merged pull request, a signed timesheet; integrations record their evidence here */
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    source: text("source").notNull().default("manual"),
    /** confirmed or rejected; rows before 05n (all confirmed) keep their default */
    state: text("state").notNull().default("confirmed"),
    /** The reason given when rejecting; null for confirmations */
    reason: text("reason"),
    /** Transaction hash that recorded this outcome onchain */
    txHash: hash("tx_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deliveries_business_fp").on(t.businessId, t.fingerprint),
    check("deliveries_state", sql`${t.state} in ('confirmed', 'rejected')`),
    check("deliveries_reason_only_on_rejection", sql`${t.state} = 'rejected' or ${t.reason} is null`),
    check("deliveries_tx_hash_format", sql`${t.txHash} is null or ${t.txHash} ~ ${sql.raw(`'${HASH}'`)}`),
  ],
);

export const earlyPayOffers = pgTable(
  "early_pay_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: hash("fingerprint").notNull(),
    discountBps: integer("discount_bps").notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    /** The Seal's signature over the EarlyPayOffer; null for a counter the vendor hasn't signed */
    signature: text("signature"),
    status: text("status").notNull().default("open"),
    createdAt: createdAt(),
  },
  (t) => [
    index("early_pay_offers_fp").on(t.fingerprint),
    check("early_pay_offers_bps", sql`${t.discountBps} between 1 and 5000`),
    check("early_pay_offers_status", sql`${t.status} in ('open', 'accepted', 'countered', 'declined', 'expired', 'used', 'withdrawn')`),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    fingerprint: hash("fingerprint").notNull(),
    credit: amount("credit").notNull(),
    signer: address("signer").notNull(),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(),
    signature: text("signature").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("approvals_unique").on(t.businessId, t.fingerprint, t.signer, t.credit)],
);

/** A vendor's recurring series (plan 15): every period is sealed up front; Symbolon only releases them on schedule */
export const recurringSeries = pgTable("recurring_series", {
  id: uuid("id").primaryKey().defaultRandom(),
  seal: address("seal").notNull(),
  businessId: uuid("business_id").references(() => businesses.id),
  description: text("description"),
  status: text("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const seriesInvoices = pgTable(
  "series_invoices",
  {
    seriesId: uuid("series_id").notNull().references(() => recurringSeries.id),
    period: integer("period").notNull(),
    fingerprint: hash("fingerprint").notNull(),
    envelope: text("envelope").notNull(),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.period] }), uniqueIndex("series_invoices_fp").on(t.fingerprint), index("series_invoices_due").on(t.releaseAt)],
);

/**
 * Vendor-signed requests that change money routing or an invoice: a new payout address, a Seal rotation (signed by
 * the old Seal), a cancellation or a credit note. Stored with the vendor's signature; changes to payouts and Seals
 * only take effect when the business owner confirms onchain and the Vault's cooldown passes (spec §3: change is
 * slow and loud).
 */
export const vendorRequests = pgTable(
  "vendor_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").references(() => businesses.id),
    seal: address("seal").notNull(),
    kind: text("kind").notNull(),
    /** The signed EIP-712 message, amounts and nonces as decimal strings */
    message: jsonb("message").$type<Record<string, unknown>>().notNull(),
    signature: text("signature").notNull(),
    /** For cancel / credit note: the invoice it applies to */
    fingerprint: hash("fingerprint"),
    status: text("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    txHash: hash("tx_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("vendor_requests_business_status").on(t.businessId, t.status),
    uniqueIndex("vendor_requests_business_signature").on(t.businessId, t.signature),
    uniqueIndex("vendor_requests_null_business_signature").on(t.signature).where(sql`${t.businessId} is null`),
    check("vendor_requests_kind", sql`${t.kind} in ('payout_change', 'seal_rotation', 'cancel', 'credit_note')`),
    check("vendor_requests_status", sql`${t.status} in ('pending', 'confirmed', 'rejected', 'applied', 'cancelled')`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------------
// Decision records: append-only (a trigger rejects UPDATE and DELETE; see migrations)
// ---------------------------------------------------------------------------------------------------------------------

export const decisions = pgTable(
  "decisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    /** e.g. pay, hold, early_pay, sweep, redeem, escalate, decline, refuse */
    kind: text("kind").notNull(),
    subject: text("subject"),
    /** The canonical record (inputs, options, rule, outcome); `hash` is keccak256 of its canonical JSON */
    record: jsonb("record").$type<Record<string, unknown>>().notNull(),
    hash: hash("hash").notNull(),
    /** A later row for the same decision carries the transaction; rows are never edited */
    txHash: hash("tx_hash"),
    supersedes: uuid("supersedes"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("decisions_hash_key").on(t.hash),
    index("decisions_business_time").on(t.businessId, t.createdAt),
    index("decisions_subject").on(t.subject),
  ],
);

/** Batches of decision hashes anchored onchain with `SymbolonVault.anchorDecisions(root, count)` */
export const decisionAnchors = pgTable("decision_anchors", {
  root: hash("root").primaryKey(),
  businessId: uuid("business_id").notNull().references(() => businesses.id),
  count: integer("count").notNull(),
  /** The decision hashes in leaf order, so any one can be proven against the root */
  leaves: jsonb("leaves").$type<string[]>().notNull(),
  txHash: hash("tx_hash"),
  createdAt: createdAt(),
});

/** Execution history and leases for Steward passes */
export const stewardRuns = pgTable(
  "steward_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    trigger: text("trigger").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    startedBy: uuid("started_by").references(() => users.id),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
  },
  (t) => [
    uniqueIndex("steward_runs_active_unique").on(t.businessId).where(sql`${t.status} = 'running'`),
    index("steward_runs_business_started_idx").on(t.businessId, t.startedAt),
    check("steward_runs_trigger_check", sql`${t.trigger} in ('manual', 'schedule')`),
    check("steward_runs_mode_check", sql`${t.mode} in ('shadow', 'assist', 'auto')`),
    check("steward_runs_status_check", sql`${t.status} in ('running', 'done', 'failed', 'skipped_paused', 'skipped_fees')`),
  ],
);

// ---------------------------------------------------------------------------------------------------------------------
// Chain sync
// ---------------------------------------------------------------------------------------------------------------------

export const chainEvents = pgTable(
  "chain_events",
  {
    chainId: integer("chain_id").notNull(),
    txHash: hash("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }),
    address: address("address").notNull(),
    eventName: text("event_name").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.chainId, t.txHash, t.logIndex] }),
    index("chain_events_address_block").on(t.address, t.blockNumber),
  ],
);

/** How far each log stream has been scanned; resume from `block + 1` */
export const syncCursors = pgTable("sync_cursors", {
  key: text("key").primaryKey(),
  chainId: integer("chain_id").notNull(),
  block: bigint("block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    subject: text("subject"),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    sentVia: text("sent_via"),
    /** Idempotency key for event deduplication (plan 05u N2) */
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("notifications_user_unread").on(t.userId, t.readAt),
    uniqueIndex("notifications_user_dedupe_key").on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
  ],
);

export const queuedChangeStatus = pgEnum("queued_change_status", ["queued", "applied", "cancelled"]);

/** Queued loosening changes delayed by the Vault (spec §9, plan 05t Q1) */
export const queuedChanges = pgTable(
  "queued_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    kind: text("kind").notNull(),
    changeId: hash("change_id").notNull(),
    selector: text("selector").notNull(),
    calldata: text("calldata"),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    eta: timestamp("eta", { withTimezone: true }).notNull(),
    status: queuedChangeStatus("status").notNull().default("queued"),
    queueTx: text("queue_tx"),
    appliedTx: text("applied_tx"),
    cancelledTx: text("cancelled_tx"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("queued_changes_business_change_id_key").on(t.businessId, t.changeId),
    index("queued_changes_business_status_idx").on(t.businessId, t.status),
    index("queued_changes_business_eta_idx").on(t.businessId, t.eta),
    check("queued_changes_change_id_format", sql`${t.changeId} ~ ${sql.raw(`'${HASH}'`)}`),
    check("queued_changes_selector_format", sql`${t.selector} ~ '^0x[0-9a-f]{8}$'`),
  ],
);

/** Team invitations by secret link (plan 05t, Q9) */
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    role: memberRole("role").notNull(),
    budgets: jsonb("budgets").$type<string[]>().notNull().default([]),
    label: text("label"),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("team_invitations_token_hash_key").on(t.tokenHash),
    index("team_invitations_business_idx").on(t.businessId, t.createdAt),
    check("team_invitations_token_hash_format", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("team_invitations_role_not_owner", sql`${t.role} in ('approver', 'requester', 'viewer')`),
    check("team_invitations_single_terminal_state", sql`not (${t.acceptedAt} is not null and ${t.revokedAt} is not null)`),
  ],
);

/** Budgets configured for a business (plan 05t, Q17) */
export const budgets = pgTable(
  "budgets",
  {
    businessId: uuid("business_id").notNull().references(() => businesses.id),
    budgetId: hash("budget_id").notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.businessId, t.budgetId] }),
    uniqueIndex("budgets_business_name_lower_key").on(t.businessId, sql`lower(${t.name})`),
    check("budgets_budget_id_format", sql`${t.budgetId} ~ ${sql.raw(`'${HASH}'`)}`),
  ],
);


