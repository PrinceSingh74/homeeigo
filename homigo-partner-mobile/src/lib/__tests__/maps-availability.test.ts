import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP_UNAVAILABLE_NOTE, nativeMapAvailable } from "../maps-availability.ts";

/**
 * X-74 (emulator 2026-09-29): an Android build made without EXPO_PUBLIC_GOOGLE_MAPS_API_KEY has no
 * `com.google.android.geo.API_KEY` in its manifest, and mounting a Google MapView in it throws
 * "API key not found" from the Maps SDK — HQ → Live Map took the whole app down to a red box.
 * The screen must know the build has no key and show the jobs without a map instead.
 */
test("Android needs the build's Google Maps key; iOS uses Apple Maps", () => {
  assert.equal(nativeMapAvailable("android", { android: { config: { googleMaps: { apiKey: "k" } } } }), true);
  assert.equal(nativeMapAvailable("android", { android: { config: { googleMaps: { apiKey: "" } } } }), false);
  assert.equal(nativeMapAvailable("android", { android: { config: {} } }), false);
  assert.equal(nativeMapAvailable("android", null), false);
  assert.equal(nativeMapAvailable("ios", null), true);
  assert.match(MAP_UNAVAILABLE_NOTE, /map/i);
});

test("the live map screen never mounts MapView without checking the build has a map", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "screens", "partner-live-map.tsx"), "utf8");
  assert.match(src, /nativeMapAvailable\(/, "partner-live-map.tsx must call nativeMapAvailable()");
  const guard = src.indexOf("mapAvailable ?");
  const mapView = src.indexOf("<MapView");
  assert.ok(guard > -1 && mapView > guard, "<MapView> must sit inside the `mapAvailable ?` branch");
  assert.match(src, /MAP_UNAVAILABLE_NOTE/);
});
