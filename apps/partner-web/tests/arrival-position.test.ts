import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readRememberedPartnerFix, rememberPartnerFix } from "../src/lib/partner-coords";

/**
 * Arrival bypass, 2026-10-06: the GPS dropdown offered "I'm at the customer", which stored the JOB's
 * coordinates as the partner's position and pinned them — the server's proximity check on `/arrived`
 * and `/start` then compared the job with itself and always passed. "Use last saved GPS" pinned too,
 * so one old fix stayed "current" for the rest of the session. A position sent as the partner's must
 * come from the device, and a remembered one must age out.
 */
const root = join(import.meta.dir, "..", "src");
const coords = readFileSync(join(root, "lib", "partner-coords.ts"), "utf8");
const menu = readFileSync(join(root, "components", "requests", "LocationAccessMenu.tsx"), "utf8");
const card = readFileSync(join(root, "components", "requests", "BookingRequestCard.tsx"), "utf8");

const realNow = Date.now;
afterEach(() => {
  Date.now = realNow;
});

describe("a remembered fix always ages out", () => {
  test("a fix older than the max age is never returned", () => {
    const t0 = realNow();
    Date.now = () => t0;
    rememberPartnerFix(12.9716, 77.5946);
    expect(readRememberedPartnerFix(120_000)).toEqual({ latitude: 12.9716, longitude: 77.5946 });
    Date.now = () => t0 + 120_001;
    expect(readRememberedPartnerFix(120_000)).toBeNull();
  });

  test("a third argument cannot pin it", () => {
    const t0 = realNow();
    Date.now = () => t0;
    // The old signature was (lat, lng, pinned). Whatever a caller passes there, age still applies.
    (rememberPartnerFix as (...args: unknown[]) => void)(12.9716, 77.5946, true);
    Date.now = () => t0 + 10 * 60_000;
    expect(readRememberedPartnerFix(120_000)).toBeNull();
  });

  test("a fix captured earlier is aged from its capture time, not from when it was stored", () => {
    const t0 = realNow();
    Date.now = () => t0;
    // A presence fix the server captured ten minutes ago is ten minutes old, not fresh.
    rememberPartnerFix(12.9716, 77.5946, t0 - 10 * 60_000);
    expect(readRememberedPartnerFix(120_000)).toBeNull();
    expect(readRememberedPartnerFix(30 * 60_000)).toEqual({ latitude: 12.9716, longitude: 77.5946 });
  });

  test("the module has no pinning", () => {
    expect(coords).not.toMatch(/pinned/i);
  });
});

describe("the GPS dropdown cannot submit the job's coordinates as the partner's", () => {
  test("there is no 'job' choice and no job coordinates in the menu", () => {
    expect(menu).not.toContain('"job"');
    expect(menu).not.toContain("jobCoords");
    expect(menu).not.toMatch(/at the customer/i);
    expect(menu).not.toMatch(/check.?in/i);
  });

  test("the menu never stores a position itself — only the device readers do", () => {
    expect(menu).not.toContain("rememberPartnerFix");
  });

  test("the job card passes no job coordinates to it", () => {
    expect(card).not.toContain("jobCoords");
  });
});
