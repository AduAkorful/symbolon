import "server-only";
import { and, eq } from "drizzle-orm";
import { resolveBy, type ByFields } from "@symbolon/core";
import { members, users, type Database } from "@symbolon/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a vendor is told about the person at a business who acted (plan 05zt). Empty for anyone who isn't a person with a role. */
export async function byFor(db: Pick<Database, "select">, businessId: string, actor: string): Promise<ByFields> {
  if (!UUID.test(actor)) return {};
  const [row] = await db
    .select({ displayName: users.displayName, vendorVisible: users.vendorVisible, role: members.role })
    .from(users)
    .leftJoin(members, and(eq(members.userId, users.id), eq(members.businessId, businessId)))
    .where(eq(users.id, actor))
    .limit(1);
  if (!row) return {};
  return resolveBy({ displayName: row.displayName, role: row.role ?? null, vendorVisible: row.vendorVisible, userId: actor });
}
