import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, businesses, members, users, vendorInvitations } from "@symbolon/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { createInvitation, loadInvitation, revokeInvitation } from "@/lib/server/invitations";
import { AuthError } from "@/lib/server/errors";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { db = await createTestDb(); });
let vaultNo = 0;

async function fixture(role: "owner" | "viewer" = "owner") {
  const [user] = await db.insert(users).values({ email: `${crypto.randomUUID()}@example.test` }).returning();
  const [business] = await db.insert(businesses).values({ name: "Acme", chainId: 5_042_002, vault: `0x${(++vaultNo).toString(16).padStart(40, "0")}` }).returning();
  await db.insert(members).values({ businessId: business!.id, userId: user!.id, role });
  return { user: user!, business: business! };
}

describe("business vendor invitations", () => {
  it("returns a one-time bearer link but stores only its SHA-256, and exposes only public names", async () => {
    const { user, business } = await fixture();
    const made = await createInvitation(db, user, business.id, { vendorName: "Northstar Studio", contactNote: "Switchboard on signed contract" }, "https://symbolon.example");
    const token = made.link.split("/").at(-1)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
    const [stored] = await db.select().from(vendorInvitations).where(eq(vendorInvitations.id, made.id));
    expect(stored!.tokenHash).not.toBe(token);
    expect(stored!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await loadInvitation(db, token)).toEqual({ businessName: "Acme", vendorName: "Northstar Studio" });
    await expect(loadInvitation(db, "not-a-token")).rejects.toMatchObject({ status: 404, message: "This invitation can't be used." });
  });

  it("restricts invite/revoke to owners and makes a revoked token indistinguishable from invalid", async () => {
    const owner = await fixture();
    const invite = await createInvitation(db, owner.user, owner.business.id, { vendorName: "Northstar", contactNote: "Known AP line" }, "https://symbolon.example");
    const token = invite.link.split("/").at(-1)!;
    await revokeInvitation(db, owner.user, owner.business.id, invite.id);
    await expect(loadInvitation(db, token)).rejects.toMatchObject({ status: 404, message: "This invitation can't be used." });
    const viewer = await fixture("viewer");
    await expect(createInvitation(db, viewer.user, viewer.business.id, { vendorName: "X", contactNote: "Known" }, "https://symbolon.example")).rejects.toBeInstanceOf(AuthError);
  });
});
