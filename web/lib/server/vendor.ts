import { and, eq } from "drizzle-orm";
import { getAddress, isAddress, zeroAddress } from "viem";
import { registerSeal } from "@symbolon/core";
import { seals, vendorClients, type Database } from "@symbolon/db";
import { UNSAFE_TEXT } from "../text-safety";
import { AuthError } from "./errors";
import type { SessionUser } from "./session";

// Plan 05i, V1 and V5: the vendor's Seal (their own wallet), payout default, and the clients they invoice.

const HANDLE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const RESERVED = new Set(["admin", "api", "app", "help", "support", "symbolon", "verify", "www"]);
const EMAIL = /^[^\s@A-Z]+@[^\s@A-Z]+\.[^\s@A-Z]+$/;


/** A single line of text people will read: NFC, trimmed, no control or bidi characters, within a length */
export function cleanLine(value: unknown, what: string, min: number, max: number): string {
  const s = typeof value === "string" ? value.normalize("NFC").trim() : "";
  if (s.length < min || s.length > max || UNSAFE_TEXT.test(s)) {
    throw new AuthError(400, `${what} is ${min === max ? min : `${min} to ${max}`} characters, without control characters.`);
  }
  return s;
}

export interface MySeal {
  address: string;
  handle: string;
  displayName: string;
  legalName: string | null;
  website: string | null;
  payoutAddress: string | null;
}

export async function mySeal(db: Database, userId: string): Promise<MySeal | null> {
  const [s] = await db
    .select({ address: seals.address, handle: seals.handle, displayName: seals.displayName, legalName: seals.legalName, website: seals.website, payoutAddress: seals.payoutAddress })
    .from(seals)
    .where(and(eq(seals.userId, userId)))
    .limit(1);
  return s ?? null;
}

/** Same as `mySeal`, but a 403 for a person who hasn't registered one (screens send them to /v/start) */
export async function requireMySeal(db: Database, userId: string): Promise<MySeal> {
  const s = await mySeal(db, userId);
  if (!s) throw new AuthError(403, "Register your Seal first.");
  return s;
}

export function checkHandle(handle: unknown): { ok: true; handle: string } | { ok: false; reason: string } {
  if (typeof handle !== "string" || !HANDLE.test(handle)) return { ok: false, reason: "Use 3 to 40 lowercase letters, digits or hyphens, starting and ending with a letter or digit." };
  if (RESERVED.has(handle)) return { ok: false, reason: "That handle is reserved." };
  return { ok: true, handle };
}

export async function handleAvailable(db: Database, handle: unknown): Promise<{ ok: boolean; reason?: string }> {
  const c = checkHandle(handle);
  if (!c.ok) return c;
  const [taken] = await db.select({ a: seals.address }).from(seals).where(eq(seals.handle, c.handle)).limit(1);
  return taken ? { ok: false, reason: "That handle is taken." } : { ok: true };
}

/** V1: the Seal is the signed-in person's own wallet. One Seal per person. */
export async function registerMySeal(
  db: Database,
  user: Pick<SessionUser, "id" | "wallet">,
  input: Record<string, unknown>,
): Promise<{ handle: string; address: string }> {
  if (!user.wallet) throw new AuthError(409, "This account has no wallet to hold a Seal. Sign in with a wallet, or with an email that has one.");
  if (await mySeal(db, user.id)) throw new AuthError(409, "You already have a Seal.");
  const h = checkHandle(input.handle);
  if (!h.ok) throw new AuthError(400, h.reason);
  const displayName = cleanLine(input.displayName, "The name on your invoices", 2, 80);
  const legalName = input.legalName ? cleanLine(input.legalName, "The legal name", 2, 200) : undefined;
  const website = input.website ? cleanLine(input.website, "The website", 3, 200) : undefined;
  const address = getAddress(user.wallet);
  try {
    await registerSeal(db, { userId: user.id, address, handle: h.handle, displayName, ...(legalName ? { legalName } : {}), ...(website ? { website } : {}) });
  } catch (e) {
    const text = String((e as { cause?: Error }).cause?.message ?? e);
    if (/seals_handle_key|handle/i.test(text) && /unique|duplicate/i.test(text)) throw new AuthError(409, "That handle is taken.");
    if (/unique|duplicate/i.test(text)) throw new AuthError(409, "This wallet already has a Seal.");
    throw new AuthError(400, e instanceof Error ? e.message : "The Seal couldn't be registered.");
  }
  return { handle: h.handle, address: address.toLowerCase() };
}

/** The payout address new invoices start with (null = the Seal's own address) */
export async function saveVendorSettings(db: Database, user: Pick<SessionUser, "id">, input: Record<string, unknown>): Promise<{ payoutAddress: string | null }> {
  const seal = await requireMySeal(db, user.id);
  let payout: string | null = null;
  const given = input.payoutAddress;
  if (given !== undefined && given !== null && typeof given !== "string") throw new AuthError(400, "That isn't a valid payout address.");
  if (typeof given === "string" && given.trim() !== "") {
    const a = given.trim();
    if (!isAddress(a) || getAddress(a) === zeroAddress) throw new AuthError(400, "That isn't a valid payout address.");
    payout = a.toLowerCase();
    if (payout === seal.address) payout = null;
  }
  await db.update(seals).set({ payoutAddress: payout }).where(eq(seals.address, seal.address));
  return { payoutAddress: payout };
}

/** V5: a client is a name plus a Vault address or an email; remembered per Seal, matched on either identifier */
export async function upsertClient(db: Database, user: Pick<SessionUser, "id">, input: Record<string, unknown>): Promise<{ id: string; name: string; vault: string | null; email: string | null }> {
  const seal = await requireMySeal(db, user.id);
  const name = cleanLine(input.name, "The client's name", 2, 200);
  const vaultText = typeof input.vault === "string" ? input.vault.trim() : "";
  const emailText = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (!vaultText && !emailText) throw new AuthError(400, "Give the client's Vault address or an email address.");
  if (vaultText && !isAddress(vaultText)) throw new AuthError(400, "That isn't a valid Vault address.");
  if (emailText && (!EMAIL.test(emailText) || emailText.length > 254)) throw new AuthError(400, "That isn't a valid email address.");
  const vault = vaultText ? vaultText.toLowerCase() : null;
  const email = emailText || null;

  const existing = (await db.select().from(vendorClients).where(eq(vendorClients.seal, seal.address))).find(
    (c) => (vault && c.vault === vault) || (email && c.email === email),
  );
  if (existing) {
    await db.update(vendorClients).set({ name, vault: vault ?? existing.vault, email: email ?? existing.email }).where(eq(vendorClients.id, existing.id));
    return { id: existing.id, name, vault: vault ?? existing.vault, email: email ?? existing.email };
  }
  const [row] = await db.insert(vendorClients).values({ seal: seal.address, name, vault, email }).returning();
  return { id: row!.id, name, vault, email };
}

export async function listClients(db: Database, user: Pick<SessionUser, "id">) {
  const seal = await requireMySeal(db, user.id);
  return db.select().from(vendorClients).where(eq(vendorClients.seal, seal.address)).orderBy(vendorClients.name);
}
