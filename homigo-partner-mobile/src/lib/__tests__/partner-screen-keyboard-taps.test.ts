import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Found on the emulator 2026-09-29 (X-69): with the step note typed, the first tap on "Confirm" sent
 * NO request — it only dismissed the keyboard; the second tap completed the step. `PartnerScreen` wraps
 * 13 partner screens (job detail with step notes / reasons, safety report, requirement checks,
 * availability, HQ forms) in a ScrollView with the default `keyboardShouldPersistTaps` ("never").
 * Same defect class as the customer app's X-38. The shell must let a tap reach the button it lands on.
 */
test("PartnerScreen's scroll view lets taps through while the keyboard is open", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "components", "PartnerScreen.tsx"), "utf8");
  const scroll = src.match(/<ScrollView\b[^>]*>/);
  assert.ok(scroll, "PartnerScreen no longer renders a ScrollView — update this test");
  assert.match(scroll[0], /keyboardShouldPersistTaps="handled"/);
});
