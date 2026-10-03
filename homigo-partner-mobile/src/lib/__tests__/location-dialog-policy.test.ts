import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * X-62 (emulator 2026-09-29): with device location off, Google Play services' "Location Accuracy"
 * dialog reappeared ~8 times in one job. Every expo-location call on Android shows it by default
 * (`mayShowUserSettingsDialog`), and three callers run on their own — the presence heartbeat, the map's
 * position watch and the job's GPS publisher. Only a call the partner started (enable location in
 * onboarding / availability) may ask; background callers must not.
 */
const SRC = join(import.meta.dirname, "..", "..");
const BACKGROUND = ["hooks/use-partner-presence-heartbeat.ts", "hooks/use-partner-map-location.ts", "lib/tracking-publisher-instance.ts", "lib/job-coords.ts"];
const CALL = /Location\.(getCurrentPositionAsync|watchPositionAsync)\(/g;

for (const rel of BACKGROUND) {
  test(`${rel}: every position request suppresses the settings dialog`, () => {
    const text = readFileSync(join(SRC, rel), "utf8");
    const calls = [...text.matchAll(CALL)];
    assert.ok(calls.length > 0, `${rel} makes no position request any more — update this test`);
    for (const m of calls) {
      const window = text.slice(m.index!, m.index! + 400);
      assert.match(window, /mayShowUserSettingsDialog:\s*false/, `${rel}: ${m[0]} without mayShowUserSettingsDialog: false`);
    }
  });
}
