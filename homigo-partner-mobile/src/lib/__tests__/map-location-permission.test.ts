import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapPermissionCall } from "../map-location-permission.ts";

/**
 * X-75 (emulator 2026-09-29): opening HQ → Live Map started ten permission requests in three seconds
 * and Android then removed the app's task (the partner landed on the launcher). Every
 * `requestForegroundPermissionsAsync` shows the system permission activity — even when the permission
 * is already granted — which pauses the app; the hook's "app became active again" handler asked
 * again, which paused the app again, and so on. Coming back to the foreground must only CHECK.
 */
test("only opening the map or tapping retry may show the permission prompt", () => {
  assert.equal(mapPermissionCall("mount"), "request");
  assert.equal(mapPermissionCall("retry"), "request");
  assert.equal(mapPermissionCall("resume"), "check");
});

test("the map location hook never requests permission from its foreground handler", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "hooks", "use-partner-map-location.ts"), "utf8");
  const listener = src.slice(src.indexOf("AppState.addEventListener"));
  assert.ok(listener.length > 0, "the hook no longer listens to AppState — update this test");
  assert.match(listener.slice(0, 600), /start\("resume"\)/, "the foreground handler must start with the resume trigger");
  assert.doesNotMatch(listener.slice(0, 600), /start\(\)/, "the foreground handler must not start without a trigger");
  assert.match(src, /mapPermissionCall\(trigger\)/, "start() must pick request vs check through mapPermissionCall");
  assert.match(src, /let starting = false;/, "a start already in flight must not be doubled");
});
