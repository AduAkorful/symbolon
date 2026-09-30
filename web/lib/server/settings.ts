import "server-only";

import { eq } from "drizzle-orm";
import { businesses, type Database } from "@symbolon/db";
import { requireMember } from "./access";
import { appendAppDecision } from "./app-decisions";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

export interface EarlyPaySettings {
  enabled: boolean;
  minSpreadBps: number;
  cashCapBps: number;
}

/**
 * T9: Early Pay program settings. Owner-only, offchain, recorded in decisions.
 */
export async function setEarlyPay(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  settings: unknown,
): Promise<{ ok: true; earlyPay: EarlyPaySettings }> {
  await requireMember(db, user.id, businessId, "owner");

  if (!settings || typeof settings !== "object") {
    throw new AuthError(400, "Invalid Early Pay settings.");
  }

  const s = settings as Record<string, unknown>;
  const enabled = Boolean(s.enabled);
  const minSpreadBps = Number(s.minSpreadBps);
  const cashCapBps = Number(s.cashCapBps);

  if (!Number.isInteger(minSpreadBps) || minSpreadBps < 0 || minSpreadBps > 10_000) {
    throw new AuthError(400, "Minimum spread must be between 0 and 100% (0 to 10,000 bps).");
  }
  if (!Number.isInteger(cashCapBps) || cashCapBps < 0 || cashCapBps > 10_000) {
    throw new AuthError(400, "Maximum commitment must be between 0 and 100% (0 to 10,000 bps).");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  const cleanSettings: EarlyPaySettings = { enabled, minSpreadBps, cashCapBps };

  await db
    .update(businesses)
    .set({ earlyPay: cleanSettings })
    .where(eq(businesses.id, businessId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "early_pay_changed",
      subject: "settings:early_pay",
      actor: user.id,
      inputs: {
        ...(b.earlyPay ? { previous: b.earlyPay } : {}),
        next: cleanSettings,
      },
      rule: "the owner configured the Early Pay program",
      outcome: enabled ? "enabled" : "disabled",
    },
  );

  return { ok: true, earlyPay: cleanSettings };
}

/**
 * T9: Treasury cash buffer in days (1..90). Owner-only, offchain, recorded in decisions.
 */
export async function setBufferDays(
  db: Database,
  user: Pick<SessionUser, "id">,
  businessId: string,
  days: unknown,
): Promise<{ ok: true; bufferDays: number }> {
  await requireMember(db, user.id, businessId, "owner");

  const d = Number(days);
  if (!Number.isInteger(d) || d < 1 || d > 90) {
    throw new AuthError(400, "Buffer must be between 1 and 90 days.");
  }

  const [b] = await db.select().from(businesses).where(eq(businesses.id, businessId)).limit(1);
  if (!b) throw new AuthError(404, "Business not found.");

  await db
    .update(businesses)
    .set({ bufferDays: d })
    .where(eq(businesses.id, businessId));

  await appendAppDecision(
    db,
    businessId,
    {
      kind: "buffer_changed",
      subject: "settings:buffer",
      actor: user.id,
      inputs: {
        previous: b.bufferDays ?? 30,
        next: d,
      },
      rule: "the owner set the treasury operating buffer in days",
      outcome: "updated",
    },
  );

  return { ok: true, bufferDays: d };
}
