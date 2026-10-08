/**
 * The position a lifecycle call carries (arrive / start / on-site check): the fix's coordinates,
 * `null` when there is no fix, and the OS's word on whether the fix was mocked — only when it said
 * something. The server-held fix decides; this is on record as the device's own admission.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { positionBody } from "../location-mocked.ts";

type JobCoords = { latitude: number; longitude: number; mocked?: boolean };

test("no fix is sent as null coordinates with no mocked flag", () => {
  assert.deepEqual(positionBody(null), { latitude: null, longitude: null });
  assert.deepEqual(positionBody(undefined), { latitude: null, longitude: null });
});

test("a fix the OS flagged carries its flag; a fix that says nothing carries none", () => {
  const mocked: JobCoords = { latitude: 28.62, longitude: 77.37, mocked: true };
  assert.deepEqual(positionBody(mocked), { latitude: 28.62, longitude: 77.37, mocked: true });
  const honest: JobCoords = { latitude: 28.62, longitude: 77.37, mocked: false };
  assert.deepEqual(positionBody(honest), { latitude: 28.62, longitude: 77.37, mocked: false });
  const unknown: JobCoords = { latitude: 28.62, longitude: 77.37 };
  assert.deepEqual(positionBody(unknown), { latitude: 28.62, longitude: 77.37 });
  assert.equal("mocked" in positionBody(unknown), false);
});
