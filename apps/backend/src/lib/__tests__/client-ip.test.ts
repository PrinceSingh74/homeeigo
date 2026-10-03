import { afterEach, describe, expect, it } from "bun:test";
import { getClientIp } from "../client-ip";

const KEYS = ["TRUST_PROXY", "TRUST_PROXY_HOPS", "NODE_ENV", "APP_ENV"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function env(vars: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const k of KEYS) {
    const v = vars[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

const req = (headers: Record<string, string>) => new Request("http://x/api", { headers });

describe("getClientIp", () => {
  it("with TRUST_PROXY_HOPS=1 uses the entry the trusted proxy appended, not the client-supplied one", () => {
    env({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "1", NODE_ENV: "development", APP_ENV: "staging" });
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    // A spoofed chain cannot move the answer: the proxy's entry is still the right-most.
    expect(getClientIp(req({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("with two trusted hops takes the second entry from the right", () => {
    env({ TRUST_PROXY: "true", TRUST_PROXY_HOPS: "2", NODE_ENV: "production" });
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
  });

  it("without TRUST_PROXY_HOPS keeps the previous left-most behaviour", () => {
    env({ TRUST_PROXY: "true", NODE_ENV: "development", APP_ENV: "dev" });
    expect(getClientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("6.6.6.6");
  });

  it("a directly exposed deployed host ignores X-Real-IP", () => {
    env({ NODE_ENV: "development", APP_ENV: "staging" });
    expect(getClientIp(req({ "x-real-ip": "6.6.6.6" }))).toBe("direct");
  });

  it("a developer machine still honours X-Real-IP (tests simulate callers with it)", () => {
    env({ NODE_ENV: "test", APP_ENV: undefined });
    expect(getClientIp(req({ "x-real-ip": "6.6.6.6" }))).toBe("6.6.6.6");
    expect(getClientIp(req({}))).toBe("127.0.0.1");
  });
});
