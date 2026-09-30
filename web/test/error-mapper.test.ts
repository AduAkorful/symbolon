import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { routeWith } from "@/lib/server/http";
import { AuthError } from "@/lib/server/errors";

describe("API Error Contract & Information Leakage Guard (L7)", () => {
  const APP_ORIGIN = "http://localhost:3000";
  process.env.APP_ORIGIN = APP_ORIGIN;
  process.env.CHAIN_ID = "5042002";

  function mockRequest(origin = APP_ORIGIN) {
    return new Request(`${APP_ORIGIN}/api/test`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
      },
    });
  }

  const hostileErrors = [
    {
      name: "Postgres internal syntax error with table and column names",
      error: new Error('syntax error at or near "SELECT * FROM users WHERE password_hash = 1" (code: 42601)'),
    },
    {
      name: "Postgres connection error with socket and credentials",
      error: new Error("connect ECONNREFUSED postgresql://postgres:super_secret_pw@db.internal:5432/symbolon"),
    },
    {
      name: "viem RPC revert with raw calldata and internal contract details",
      error: new Error(
        "Details: execution reverted: 0x4e487b710000000000000000000000000000000000000000000000000000000000000011\n" +
          "Version: viem@2.56.9\n" +
          "Contract Call:\n" +
          "  address: 0x1234567890123456789012345678901234567890\n" +
          "  function: executePayout(bytes32,uint256)",
      ),
    },
    {
      name: "Circle API key exposure error",
      error: new Error('Circle API 401 Unauthorized: invalid API key "TEST_API_KEY_abc123xyz"'),
    },
    {
      name: "Anthropic rate limit internal body",
      error: new Error('AnthropicError: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Org limit reached"}}'),
    },
    {
      name: "Generic unhandled TypeError with stack trace",
      error: new TypeError("Cannot read properties of undefined (reading 'privateKey')"),
    },
  ];

  for (const { name, error } of hostileErrors) {
    it(`sanitizes: ${name}`, async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const handler = routeWith(async () => {
        throw error;
      });

      const response = await handler(mockRequest(), {});
      expect(response.status).toBe(500);

      const json = await response.json();
      expect(json).toEqual({ error: "Something went wrong on our side. Try again." });

      // Verify no leak of message, stack, or internal hints
      const serialized = JSON.stringify(json);
      expect(serialized).not.toContain("password");
      expect(serialized).not.toContain("postgres");
      expect(serialized).not.toContain("Details:");
      expect(serialized).not.toContain("viem");
      expect(serialized).not.toContain("Circle");
      expect(serialized).not.toContain("Anthropic");
      expect(serialized).not.toContain("stack");
      expect(serialized).not.toContain("privateKey");

      consoleSpy.mockRestore();
    });
  }

  it("permits sanitized user-facing AuthError messages with honest status codes", async () => {
    const handler = routeWith(async () => {
      throw new AuthError(403, "You must be an owner of this business to modify policy.");
    });

    const response = await handler(mockRequest(), {});
    expect(response.status).toBe(403);
    const json = await response.json();
    expect(json).toEqual({ error: "You must be an owner of this business to modify policy." });
  });

  it("strictly enforces same-origin protection before handler invocation", async () => {
    let invoked = false;
    const handler = routeWith(async () => {
      invoked = true;
      return new Response("ok");
    });

    const maliciousRequest = mockRequest("https://attacker.example");
    const response = await handler(maliciousRequest, {});
    expect(response.status).toBe(403);
    expect(invoked).toBe(false);

    const json = await response.json();
    expect(json).toEqual({ error: "That request didn't come from this app." });
  });
});
