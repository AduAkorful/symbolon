import "server-only";

import { decisions, type Database } from "@symbolon/db";
import { hashRecord, type DecisionRecord } from "@symbolon/steward";

/** App actions are decisions too: the record is append-only and uses the same canonical hash as Steward decisions. */
export async function appendAppDecision(
  db: Pick<Database, "insert">,
  businessId: string,
  input: {
    kind: string;
    subject?: string;
    actor: string;
    inputs: Record<string, unknown>;
    rule: string;
    outcome: string;
  },
): Promise<void> {
  const record: DecisionRecord = {
    version: 1,
    kind: input.kind,
    business: businessId,
    ...(input.subject ? { subject: input.subject } : {}),
    at: new Date().toISOString(),
    mode: "assist",
    inputs: { ...input.inputs, actor: input.actor },
    options: [],
    rule: input.rule,
    outcome: input.outcome,
  };
  const { hash } = hashRecord(record);
  await db.insert(decisions).values({
    businessId,
    kind: input.kind,
    subject: input.subject ?? null,
    record: record as unknown as Record<string, unknown>,
    hash,
  }).onConflictDoNothing();
}
