import "server-only";

import { sql } from "drizzle-orm";

import { decisions } from "@symbolon/db";

/**
 * Pay now writes the Vault-checked proposal before the wallet opens, because the payment's onchain decision hash must match a
 * stored record. Opening the dialog and cancelling it therefore leaves a record that nothing came of. It is kept (so a payment
 * that is sent can be matched) but is never shown as something the Steward or a person did (QA retest 5, R5-6).
 */
export const PREPARED_PAYMENT_RULE_PREFIX = "a person chose to pay now";

export function isPreparedPayment(record: unknown): boolean {
  const rule = (record as { rule?: unknown } | null)?.rule;
  return typeof rule === "string" && rule.startsWith(PREPARED_PAYMENT_RULE_PREFIX);
}

/** For `where(and(..., notPreparedPayment))` */
export const notPreparedPayment = sql`coalesce(${decisions.record}->>'rule', '') not like ${PREPARED_PAYMENT_RULE_PREFIX + "%"}`;
