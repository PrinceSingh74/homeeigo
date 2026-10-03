/**
 * Presence monitor — observability only.
 * A stale sweep must never write lifecycle, availability, job, or finance.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const SRC = join(import.meta.dir, "../services/partner-presence-monitor.service.ts");

describe("partner-presence-monitor four-axis lock", () => {
  test("sweep source never mutates an axis field", () => {
    const src = readFileSync(SRC, "utf8");
    expect(src).toContain("FOUR-AXIS LOCK");
    expect(src).not.toMatch(/prisma\.provider\.update/);
    expect(src).not.toMatch(/prisma\.booking\.(update|create)/);
    expect(src).not.toMatch(/prisma\.earning\.(update|create)/);
    expect(src).not.toMatch(/data:\s*\{\s*lifecycleState/);
    expect(src).not.toMatch(/data:\s*\{\s*isOnline/);
  });
});
