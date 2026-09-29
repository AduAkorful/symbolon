import { eq } from "drizzle-orm";
import { users, type Database } from "@symbolon/db";

/** A person with only a wallet, made directly: tests build users without going through sign-in */
export async function walletUser(db: Database, wallet: string) {
  const address = wallet.toLowerCase();
  const [found] = await db.select().from(users).where(eq(users.wallet, address)).limit(1);
  if (found) return found;
  const [made] = await db.insert(users).values({ wallet: address }).returning();
  return made!;
}
