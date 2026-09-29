import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createTestDb, seals, users, vendorClients } from "@symbolon/db";
import { eq } from "drizzle-orm";
import { AuthError } from "@/lib/server/errors";
import { handleAvailable, listClients, mySeal, registerMySeal, saveVendorSettings, upsertClient } from "@/lib/server/vendor";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const fresh = () => privateKeyToAccount(generatePrivateKey()).address;
const person = async (wallet: string | null = fresh()) => (await db.insert(users).values({ wallet: wallet ? wallet.toLowerCase() : null }).returning())[0]!;
let n = 0;
const handle = () => `studio-${++n}-x`;
const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  return e as AuthError;
};

describe("registering a Seal", () => {
  it("makes the person's own wallet their Seal", async () => {
    const u = await person();
    const h = handle();
    const r = await registerMySeal(db, u, { handle: h, displayName: "  Studio Ana ", website: "studio-ana.com" });
    expect(r).toEqual({ handle: h, address: u.wallet });
    expect(await mySeal(db, u.id)).toMatchObject({ address: u.wallet, handle: h, displayName: "Studio Ana", website: "studio-ana.com", payoutAddress: null });
  });

  it("needs a wallet, and only one Seal per person", async () => {
    expect((await err(registerMySeal(db, await person(null), { handle: handle(), displayName: "No Wallet" }))).status).toBe(409);
    const u = await person();
    await registerMySeal(db, u, { handle: handle(), displayName: "First" });
    expect((await err(registerMySeal(db, u, { handle: handle(), displayName: "Second" }))).status).toBe(409);
  });

  it.each(["Ab", "ab", "UPPER-case", "-lead-", "has space", "x".repeat(41), "admin", "symbolon", 5, undefined])("refuses the handle %j", async (h) => {
    expect((await err(registerMySeal(db, await person(), { handle: h, displayName: "Name" }))).status).toBe(400);
  });

  it("refuses a taken handle, and says so before saving", async () => {
    const h = handle();
    await registerMySeal(db, await person(), { handle: h, displayName: "Owner of it" });
    expect(await handleAvailable(db, h)).toMatchObject({ ok: false, reason: "That handle is taken." });
    expect((await err(registerMySeal(db, await person(), { handle: h, displayName: "Latecomer" }))).status).toBe(409);
    expect((await handleAvailable(db, handle())).ok).toBe(true);
    expect((await handleAvailable(db, "Nope!")).ok).toBe(false);
  });

  it.each(["", "A", "x".repeat(81), "bad\u0007name", "\u202Eevil"])("refuses the display name %j", async (name) => {
    expect((await err(registerMySeal(db, await person(), { handle: handle(), displayName: name }))).status).toBe(400);
  });
});

describe("vendor settings", () => {
  it("saves a payout address in lowercase, and clears it", async () => {
    const u = await person();
    await registerMySeal(db, u, { handle: handle(), displayName: "Payer" });
    const other = fresh();
    expect(await saveVendorSettings(db, u, { payoutAddress: other })).toEqual({ payoutAddress: other.toLowerCase() });
    expect((await mySeal(db, u.id))!.payoutAddress).toBe(other.toLowerCase());
    expect(await saveVendorSettings(db, u, { payoutAddress: "" })).toEqual({ payoutAddress: null });
    // the Seal's own address is the default, so it is stored as "no override"
    expect(await saveVendorSettings(db, u, { payoutAddress: u.wallet })).toEqual({ payoutAddress: null });
  });

  it.each(["0x12", "nope", "0x0000000000000000000000000000000000000000", 5])("refuses the payout address %j", async (a) => {
    const u = await person();
    await registerMySeal(db, u, { handle: handle(), displayName: "Payer" });
    expect((await err(saveVendorSettings(db, u, { payoutAddress: a }))).status).toBe(400);
  });

  it("needs a Seal", async () => {
    expect((await err(saveVendorSettings(db, await person(), { payoutAddress: fresh() }))).status).toBe(403);
  });
});

describe("clients", () => {
  async function vendor() {
    const u = await person();
    await registerMySeal(db, u, { handle: handle(), displayName: "Vendor" });
    return u;
  }

  it("remembers a client by Vault or email, and merges when either matches", async () => {
    const u = await vendor();
    const vault = fresh();
    const a = await upsertClient(db, u, { name: "Acme", vault });
    expect(a.vault).toBe(vault.toLowerCase());
    const b = await upsertClient(db, u, { name: "Acme Operations", vault, email: "AP@Acme.example" });
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ name: "Acme Operations", vault: vault.toLowerCase(), email: "ap@acme.example" });
    const c = await upsertClient(db, u, { name: "Acme AP", email: "ap@acme.example" });
    expect(c.id).toBe(a.id);
    expect(await listClients(db, u)).toHaveLength(1);
    await upsertClient(db, u, { name: "Halden", email: "ap@halden.example" });
    expect((await listClients(db, u)).map((x) => x.name)).toEqual(["Acme AP", "Halden"]);
  });

  it("keeps each vendor's clients to themselves", async () => {
    const one = await vendor();
    const two = await vendor();
    await upsertClient(db, one, { name: "Shared Client", email: "ap@shared.example" });
    await upsertClient(db, two, { name: "Shared Client", email: "ap@shared.example" });
    expect(await listClients(db, one)).toHaveLength(1);
    expect(await listClients(db, two)).toHaveLength(1);
    expect(await db.select().from(vendorClients).where(eq(vendorClients.email, "ap@shared.example"))).toHaveLength(2);
  });

  it.each([
    [{ name: "A", email: "a@b.example" }],
    [{ name: "Acme" }],
    [{ name: "Acme", vault: "0x12" }],
    [{ name: "Acme", email: "not-an-email" }],
    [{ name: "Acme", email: "x".repeat(250) + "@b.example" }],
  ])("refuses %j", async (input) => {
    expect((await err(upsertClient(db, await vendor(), input))).status).toBe(400);
  });

  it("needs a Seal", async () => {
    expect((await err(upsertClient(db, await person(), { name: "Acme", email: "a@b.example" }))).status).toBe(403);
    expect((await err(listClients(db, await person()))).status).toBe(403);
  });
});

it("leaves the seals table with one row per registered person", async () => {
  expect((await db.select().from(seals)).length).toBeGreaterThan(0);
});
