import { notifications, type Database } from "@symbolon/db";

export interface NotifyInput {
  userId: string;
  kind: string;
  subject?: string | null;
  body: Record<string, unknown>;
  dedupeKey?: string | null;
}

/**
 * Inserts an in-app notification idempotently using dedupeKey (plan 05u N1, N2).
 * Returns { id, duplicate: boolean }.
 */
export async function notify(
  db: Database,
  input: NotifyInput,
): Promise<{ id?: string; duplicate: boolean }> {
  const [row] = await db
    .insert(notifications)
    .values({
      userId: input.userId,
      kind: input.kind,
      subject: input.subject ?? null,
      body: input.body,
      dedupeKey: input.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  if (row) {
    return { id: row.id, duplicate: false };
  }
  return { duplicate: true };
}

/**
 * Inserts multiple notifications idempotently (plan 05u N1, N2).
 */
export async function notifyMany(
  db: Database,
  inputs: NotifyInput[],
): Promise<{ inserted: number; duplicates: number }> {
  if (inputs.length === 0) return { inserted: 0, duplicates: 0 };
  const rows = await db
    .insert(notifications)
    .values(
      inputs.map((i) => ({
        userId: i.userId,
        kind: i.kind,
        subject: i.subject ?? null,
        body: i.body,
        dedupeKey: i.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id });

  return { inserted: rows.length, duplicates: inputs.length - rows.length };
}
