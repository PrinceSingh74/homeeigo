/**
 * The mock-location signal: Android says on every fix whether it came from a mock provider (a
 * fake-GPS app). The app passes that on with the fix, and never invents it — iOS, the web and an
 * older OS say nothing, and "nothing" must reach the server as nothing, not as "not mocked".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mockedField } from "../location-mocked.ts";

test("the OS's word is passed on exactly: true stays true, false stays false", () => {
  assert.deepEqual(mockedField({ mocked: true }), { mocked: true });
  assert.deepEqual(mockedField({ mocked: false }), { mocked: false });
});

test("a fix that says nothing sends nothing — never a default of false", () => {
  assert.deepEqual(mockedField({}), {});
  assert.deepEqual(mockedField({ mocked: undefined }), {});
  assert.deepEqual(mockedField({ mocked: null }), {});
  assert.deepEqual(mockedField(null), {});
  assert.deepEqual(mockedField(undefined), {});
  // Not a boolean is not the OS's word.
  assert.deepEqual(mockedField({ mocked: "true" as unknown as boolean }), {});
  assert.deepEqual(mockedField({ mocked: 0 as unknown as boolean }), {});
});

test("it spreads into a location body beside the coordinates", () => {
  const body = { latitude: 28.62, longitude: 77.37, ...mockedField({ mocked: true }) };
  assert.deepEqual(body, { latitude: 28.62, longitude: 77.37, mocked: true });
  assert.equal("mocked" in { latitude: 1, longitude: 2, ...mockedField({}) }, false);
});
