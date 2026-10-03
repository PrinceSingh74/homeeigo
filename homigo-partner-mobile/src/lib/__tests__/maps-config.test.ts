import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";

/**
 * Maps configuration (release hardening 2026-09-30). The Android Maps key reaches the manifest only
 * through app.config.js from EXPO_PUBLIC_GOOGLE_MAPS_API_KEY. Missing → no key, the Live Map shows its
 * "Map unavailable" fallback (X-74). Malformed → previously baked in as-is: the map mounted and failed
 * authorisation at runtime (grey map). Now a malformed value fails the build config, loudly, without
 * printing the value.
 */
const require = createRequire(import.meta.url);
const CONFIG = join(import.meta.dirname, "..", "..", "..", "app.config.js");

function loadConfig(key: string | undefined) {
  const prev = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (key === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  else process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = key;
  try {
    delete require.cache[require.resolve(CONFIG)];
    return (require(CONFIG) as () => { android?: { package?: string; config?: { googleMaps?: { apiKey?: string } } } })();
  } finally {
    if (prev === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
    else process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = prev;
  }
}

test("the partner app's Android package is com.homeeigo.partner (the Maps key's package restriction)", () => {
  assert.equal(loadConfig(undefined).android?.package, "com.homeeigo.partner");
});

test("no key configured → no key in the build (runtime fallback)", () => {
  assert.equal(loadConfig(undefined).android?.config?.googleMaps?.apiKey, undefined);
  assert.equal(loadConfig("  ").android?.config?.googleMaps?.apiKey, undefined);
});

test("a well-formed key is written to the Android config", () => {
  const key = "AIza" + "B".repeat(35);
  assert.equal(loadConfig(key).android?.config?.googleMaps?.apiKey, key);
});

test("a malformed key fails the config and the message never contains the value", () => {
  for (const bad of ["YOUR_KEY_HERE", "AIza-too-short", "malformed-provider-key-sample"]) {
    assert.throws(() => loadConfig(bad), (e: Error) => /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY/.test(e.message) && !e.message.includes(bad));
  }
});
