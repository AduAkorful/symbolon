import { beforeAll, describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { createSiweMessage } from "viem/siwe";
import { arcTestnet } from "@symbolon/chain";
import { createTestDb } from "@symbolon/db";
import { AuthError } from "@/lib/server/errors";
import { NONCE_TTL_MS, issueWalletChallenge, verifyWalletSignIn, type SignatureVerifier } from "@/lib/server/siwe";

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  db = await createTestDb();
});

const s = { appOrigin: "https://app.symbolon.test", chainId: arcTestnet.id };
const T0 = new Date("2026-09-29T10:00:00Z");
// A plain-key check with no RPC: the smart-contract path is exercised by swapping in a different verifier below
const eoa: SignatureVerifier = ({ address, message, signature }) => verifyMessage({ address, message, signature });

async function signIn(mutate?: (message: string) => string, opts: { key?: `0x${string}`; verify?: SignatureVerifier; at?: Date; settings?: typeof s } = {}) {
  const account = privateKeyToAccount(opts.key ?? generatePrivateKey());
  const { message } = await issueWalletChallenge(db, s, account.address, T0);
  const shown = mutate ? mutate(message) : message;
  const signature = await account.signMessage({ message: shown });
  return { account, message: shown, signature, run: () => verifyWalletSignIn(db, opts.settings ?? s, { message: shown, signature }, opts.verify ?? eoa, opts.at ?? new Date(T0.getTime() + 1000)) };
}

const refused = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  return e as AuthError;
};

describe("wallet sign-in (EIP-4361)", () => {
  it("accepts a message this server issued, signed by the wallet, and returns the lowercase address", async () => {
    const t = await signIn();
    expect(await t.run()).toBe(t.account.address.toLowerCase());
  });

  it("issues a message pinned to this site, this chain and a 10 minute life", async () => {
    const { message } = await issueWalletChallenge(db, s, privateKeyToAccount(generatePrivateKey()).address, T0);
    expect(message).toContain("app.symbolon.test wants you to sign in");
    expect(message).toContain(`Chain ID: ${arcTestnet.id}`);
    expect(message).toContain(`Expiration Time: ${new Date(T0.getTime() + NONCE_TTL_MS).toISOString()}`);
  });

  it("counts a message once: the second use is refused", async () => {
    const t = await signIn();
    await t.run();
    expect((await refused(t.run())).status).toBe(401);
  });

  it("refuses an expired message", async () => {
    const t = await signIn(undefined, { at: new Date(T0.getTime() + NONCE_TTL_MS + 1000) });
    expect((await refused(t.run())).message).toMatch(/expired/);
  });

  it("refuses a message the server never issued (a nonce it doesn't know)", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const message = createSiweMessage({
      address: account.address,
      chainId: s.chainId,
      domain: "app.symbolon.test",
      nonce: "madeupnonce12345",
      uri: s.appOrigin,
      version: "1",
      issuedAt: T0,
      expirationTime: new Date(T0.getTime() + NONCE_TTL_MS),
    });
    const signature = await account.signMessage({ message });
    expect((await refused(verifyWalletSignIn(db, s, { message, signature }, eoa, T0))).message).toMatch(/never issued/);
  });

  it("refuses a message for another site or another chain", async () => {
    const other = await signIn((m) => m.replace("app.symbolon.test", "evil.example"));
    expect((await refused(other.run())).message).toMatch(/different site/);
    const chain = await signIn((m) => m.replace(`Chain ID: ${arcTestnet.id}`, "Chain ID: 1"));
    expect((await refused(chain.run())).message).toMatch(/different chain/);
  });

  it("refuses a URI on another origin even when the domain line is right", async () => {
    const t = await signIn((m) => m.replace(/URI: .*/, "URI: https://evil.example"));
    expect((await refused(t.run())).message).toMatch(/different site/);
  });

  it("refuses a signature from another key", async () => {
    const t = await signIn();
    const impostor = privateKeyToAccount(generatePrivateKey());
    const signature = await impostor.signMessage({ message: t.message });
    expect((await refused(verifyWalletSignIn(db, s, { message: t.message, signature }, eoa, T0))).message).toMatch(/doesn't match/);
  });

  it("refuses a message whose address line was swapped after signing", async () => {
    const victim = privateKeyToAccount(generatePrivateKey());
    const t = await signIn((m) => m.replace(/0x[0-9a-fA-F]{40}/, victim.address));
    expect((await refused(t.run())).message).toMatch(/doesn't match/);
  });

  it("refuses incomplete messages and a signature that isn't hex", async () => {
    expect((await refused(verifyWalletSignIn(db, s, { message: "hello", signature: "0x00" }, eoa, T0))).message).toMatch(/incomplete/);
    expect((await refused(verifyWalletSignIn(db, s, { message: "hello", signature: "nothex" }, eoa, T0))).message).toMatch(/hex/);
  });

  it("accepts a smart-contract wallet when the verifier says its signature is valid, and refuses when it says no", async () => {
    const yes: SignatureVerifier = async () => true;
    const no: SignatureVerifier = async () => false;
    const t = await signIn(undefined, { verify: yes });
    expect(await t.run()).toBe(t.account.address.toLowerCase());
    const n = await signIn(undefined, { verify: no });
    expect((await refused(n.run())).status).toBe(401);
  });

  it("treats a verifier that throws (RPC down) as a refusal, never a pass", async () => {
    const boom: SignatureVerifier = async () => {
      throw new Error("rpc down");
    };
    const t = await signIn(undefined, { verify: boom });
    expect((await refused(t.run())).status).toBe(502);
  });

  it("refuses to issue a message for something that isn't an address", async () => {
    expect((await refused(issueWalletChallenge(db, s, "not-an-address", T0))).status).toBe(400);
  });
});
