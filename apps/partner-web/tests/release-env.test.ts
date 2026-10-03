import { describe, expect, test } from "bun:test";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkReleaseEnv } = require("../scripts/release-env.cjs") as {
  checkReleaseEnv(env: Record<string, string | undefined>): { errors: string[]; warnings: string[] };
};

/**
 * Release hardening (2026-09-30): `next.config` proxies `/api/*` to `BACKEND_ORIGIN || "http://localhost:3000"`,
 * so a production build made without either backend variable shipped a partner app that talked to
 * localhost — silently. `npm run build:release` refuses such an environment; CI's compile-only
 * `npm run build` keeps working (it only warns).
 */
describe("partner web release environment", () => {
  const good = { BACKEND_ORIGIN: "https://api.homeeigo.com", NEXT_PUBLIC_WS_URL: "wss://api.homeeigo.com", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0" };

  test("a complete https / wss environment passes", () => {
    expect(checkReleaseEnv(good).errors).toEqual([]);
  });

  test("no backend variable at all is refused (the proxy would fall back to localhost)", () => {
    const { errors } = checkReleaseEnv({ ...good, BACKEND_ORIGIN: undefined });
    expect(errors.join(" ")).toMatch(/BACKEND_ORIGIN|NEXT_PUBLIC_API_URL/);
  });

  test("a localhost or plain-http backend is refused", () => {
    for (const v of ["http://localhost:3000", "http://127.0.0.1:3100", "http://[::1]:3000", "http://api.homeeigo.com"]) {
      expect(checkReleaseEnv({ ...good, BACKEND_ORIGIN: v }).errors.length).toBeGreaterThan(0);
      expect(checkReleaseEnv({ ...good, BACKEND_ORIGIN: undefined, NEXT_PUBLIC_API_URL: v }).errors.length).toBeGreaterThan(0);
    }
  });

  test("a ws:// or localhost realtime url is refused; dev-only port override is refused", () => {
    expect(checkReleaseEnv({ ...good, NEXT_PUBLIC_WS_URL: "ws://localhost:3000" }).errors.length).toBeGreaterThan(0);
    expect(checkReleaseEnv({ ...good, NEXT_PUBLIC_API_PORT: "3100" }).errors.length).toBeGreaterThan(0);
  });

  test("a missing or malformed Maps key is a warning (the map shows its own fallback), never an error", () => {
    expect(checkReleaseEnv({ ...good, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: undefined }).warnings.join(" ")).toMatch(/GOOGLE_MAPS/);
    const bad = checkReleaseEnv({ ...good, NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "YOUR_KEY_HERE" });
    expect(bad.errors).toEqual([]);
    expect(bad.warnings.join(" ")).toMatch(/GOOGLE_MAPS/);
  });

  test("messages never contain a secret value", () => {
    const r = checkReleaseEnv({ ...good, BACKEND_ORIGIN: "http://localhost:3000", NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "YOUR_KEY_HERE" });
    expect(JSON.stringify(r)).not.toContain(good.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
    expect(JSON.stringify(r)).not.toContain("YOUR_KEY_HERE");
  });
});
