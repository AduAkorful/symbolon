import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createTestDb, users, businesses, members, seals, sessions, type Database } from "@symbolon/db";
import { getProfile, updateDisplayName } from "@/lib/server/profile";

const ADDR = "0x530df8c969be62acbdc58aa33bc40027b66007d0";

describe("profile", () => {
  let db: Database;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    db = await createTestDb();
    const [uA] = await db.insert(users).values({ email: "ana@studio.example", wallet: ADDR }).returning();
    const [uB] = await db.insert(users).values({ email: "bob@acme.example" }).returning();
    userA = uA!.id;
    userB = uB!.id;
  });

  describe("getProfile", () => {
    it("returns user details, active sessions with isCurrent, and accounts", async () => {
      // Add sessions
      const now = new Date();
      const expires = new Date(now.getTime() + 100000);
      const [s1] = await db
        .insert(sessions)
        .values({
          userId: userA,
          tokenHash: "hash1",
          method: "privy",
          expiresAt: expires,
        })
        .returning();

      // Add a business membership
      const [biz] = await db.insert(businesses).values({ name: "Studio Ana Ltd", chainId: 5042002 }).returning();
      await db.insert(members).values({ businessId: biz!.id, userId: userA, role: "owner" });

      // Add a Seal
      await db.insert(seals).values({
        address: ADDR,
        userId: userA,
        handle: "studio-ana",
        displayName: "Studio Ana",
      });

      const profile = await getProfile(db, userA, s1!.id);
      expect(profile.user.email).toBe("ana@studio.example");
      expect(profile.user.wallet).toBe(ADDR);
      expect(profile.sessions).toHaveLength(1);
      expect(profile.sessions[0]?.isCurrent).toBe(true);
      expect(profile.accounts.businesses).toHaveLength(1);
      expect(profile.accounts.businesses[0]?.name).toBe("Studio Ana Ltd");
      expect(profile.accounts.seal?.handle).toBe("studio-ana");
    });
  });

  describe("updateDisplayName", () => {
    it("updates valid display name", async () => {
      const res = await updateDisplayName(db, userA, "  Ana Ferreira  ");
      expect(res.ok).toBe(true);
      expect(res.displayName).toBe("Ana Ferreira");

      const profile = await getProfile(db, userA);
      expect(profile.user.displayName).toBe("Ana Ferreira");
    });

    it("rejects empty name or too long name (>80 chars)", async () => {
      await expect(updateDisplayName(db, userA, "")).rejects.toThrow();
      await expect(updateDisplayName(db, userA, "   ")).rejects.toThrow();
      await expect(updateDisplayName(db, userA, "x".repeat(81))).rejects.toThrow();
    });

    it("rejects control and bidi override characters", async () => {
      await expect(updateDisplayName(db, userA, "Ana\u202Ereversed")).rejects.toThrow();
      await expect(updateDisplayName(db, userA, "Ana\x00null")).rejects.toThrow();
    });

    it("rejects names formatted like an EVM address", async () => {
      await expect(updateDisplayName(db, userA, "0x1234567890123456789012345678901234567890")).rejects.toThrow();
    });

    it("rejects names matching another user's email", async () => {
      await expect(updateDisplayName(db, userA, "bob@acme.example")).rejects.toThrow();
    });
  });
});
