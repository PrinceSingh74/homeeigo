import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";

const { checkReleaseEnv } = createRequire(import.meta.url)("../../../scripts/check-release-env.cjs") as {
  checkReleaseEnv: (
    env: Record<string, string | undefined>,
    opts?: { requireSiteUrl?: boolean },
  ) => { errors: string[]; warnings: string[] };
};

const GOOD = {
  NEXT_PUBLIC_API_URL: "https://api.example.com",
  NEXT_PUBLIC_WS_URL: "wss://api.example.com/ws",
  NEXT_PUBLIC_SITE_URL: "https://www.example.com",
  NEXT_PUBLIC_SENTRY_DSN: "set",
};

describe("release env guard (customer web / admin)", () => {
  it("accepts a complete public https configuration", () => {
    expect(checkReleaseEnv(GOOD, { requireSiteUrl: true })).toEqual({ errors: [], warnings: [] });
  });

  it("refuses a missing backend, a local backend and plain http", () => {
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_API_URL: undefined }).errors.length).toBe(1);
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_API_URL: "http://localhost:3000" }).errors.join(" ")).toMatch(/local address/);
    expect(checkReleaseEnv({ ...GOOD, BACKEND_ORIGIN: "http://api.example.com" }).errors.join(" ")).toMatch(/https/);
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_WS_URL: "ws://api.example.com" }).errors.join(" ")).toMatch(/wss/);
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_API_PORT: "3100" }).errors.join(" ")).toMatch(/API_PORT/);
  });

  it("customer web must name its public site url", () => {
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_SITE_URL: undefined }, { requireSiteUrl: true }).errors.join(" ")).toMatch(/SITE_URL/);
    expect(checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_SITE_URL: undefined }).errors).toEqual([]);
  });

  it("never echoes a value", () => {
    const secretish = "http://localhost:3999/very-identifying-path";
    const { errors } = checkReleaseEnv({ ...GOOD, NEXT_PUBLIC_API_URL: secretish });
    expect(errors.join(" ")).not.toContain("very-identifying-path");
  });
});
