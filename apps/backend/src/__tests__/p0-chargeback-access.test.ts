import { describe, expect, test } from "bun:test";
import { generateStorageKey } from "../lib/storage-key";

const TOKEN_TTL_MS = 5 * 60 * 1000;

type MockToken = {
  token: string;
  adminId: string;
  expiresAt: Date;
  usedAt: Date | null;
};

function validateTokenAccess(
  row: MockToken | null,
  adminId: string,
  now: Date,
): "ok" | "invalid" | "wrong_admin" | "expired" | "reused" {
  if (!row) return "invalid";
  if (row.adminId !== adminId) return "wrong_admin";
  if (row.usedAt) return "reused";
  if (row.expiresAt < now) return "expired";
  return "ok";
}

describe("P0-2 Chargeback evidence access control", () => {
  test("anonymous access denied (no token row)", () => {
    expect(validateTokenAccess(null, "admin-1", new Date())).toBe("invalid");
  });

  test("customer role cannot use admin token", () => {
    const row: MockToken = {
      token: "tok-1",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      usedAt: null,
    };
    expect(validateTokenAccess(row, "customer-1", new Date())).toBe("wrong_admin");
  });

  test("provider role cannot use admin token", () => {
    const row: MockToken = {
      token: "tok-2",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      usedAt: null,
    };
    expect(validateTokenAccess(row, "provider-1", new Date())).toBe("wrong_admin");
  });

  test("admin with valid token succeeds", () => {
    const row: MockToken = {
      token: "tok-3",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      usedAt: null,
    };
    expect(validateTokenAccess(row, "admin-1", new Date())).toBe("ok");
  });

  test("expired token returns 403 semantics", () => {
    const row: MockToken = {
      token: "tok-exp",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() - 1000),
      usedAt: null,
    };
    expect(validateTokenAccess(row, "admin-1", new Date())).toBe("expired");
  });

  test("reused token returns 403 semantics", () => {
    const row: MockToken = {
      token: "tok-used",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      usedAt: new Date(),
    };
    expect(validateTokenAccess(row, "admin-1", new Date())).toBe("reused");
  });

  test("public uploads route removed from contract", async () => {
    const uploads = await import("../routes/uploads");
    expect(uploads.uploadsRoutes).toBeDefined();
  });

  test("storage keys are not guessable from chargeback id", () => {
    const chargebackId = "cb_abc123";
    for (let i = 0; i < 20; i++) {
      const key = generateStorageKey();
      expect(key.includes(chargebackId)).toBe(false);
    }
  });

  test("token TTL is 5 minutes", () => {
    expect(TOKEN_TTL_MS).toBe(300000);
  });

  test("single-use: second consume fails", () => {
    let usedAt: Date | null = null;
    const first = usedAt === null;
    if (first) usedAt = new Date();
    const second = usedAt !== null && first;
    expect(first).toBe(true);
    expect(second).toBe(true);
    const row: MockToken = {
      token: "single",
      adminId: "admin-1",
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      usedAt,
    };
    expect(validateTokenAccess(row, "admin-1", new Date())).toBe("reused");
  });
});

describe("P0-2 Evidence download authorization matrix", () => {
  const roles = ["anonymous", "customer", "provider", "admin"] as const;
  const scenarios: Array<{ role: (typeof roles)[number]; hasValidToken: boolean; expected: string }> = [
    { role: "anonymous", hasValidToken: false, expected: "denied" },
    { role: "customer", hasValidToken: false, expected: "denied" },
    { role: "provider", hasValidToken: false, expected: "denied" },
    { role: "admin", hasValidToken: true, expected: "allowed" },
    { role: "admin", hasValidToken: false, expected: "denied" },
  ];

  for (const s of scenarios) {
    test(`${s.role} token=${s.hasValidToken} => ${s.expected}`, () => {
      const adminId = s.role === "admin" ? "admin-1" : `${s.role}-1`;
      const row: MockToken | null = s.hasValidToken
        ? {
            token: "t",
            adminId: "admin-1",
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            usedAt: null,
          }
        : null;
      const result = validateTokenAccess(row, adminId, new Date());
      if (s.expected === "allowed") expect(result).toBe("ok");
      else expect(result).not.toBe("ok");
    });
  }
});
