import assert from "node:assert/strict";
import { test } from "node:test";
import { quietSubscription, removeQuietly } from "../safe-subscription.ts";

/**
 * Found by driving the app in a browser: reporting a customer no-show closed the job, the tracking
 * watch was stopped, `remove()` threw, and the job screen was replaced by "Something went wrong".
 */
test("a subscription whose remove() throws does not throw out of removeQuietly", () => {
  const broken = { remove: () => { throw new TypeError("LocationEventEmitter.removeSubscription is not a function"); } };
  assert.doesNotThrow(() => removeQuietly(broken));
  assert.doesNotThrow(() => quietSubscription(broken).remove());
});

test("a working subscription is removed exactly once per call, and null is ignored", () => {
  let calls = 0;
  const sub = { remove: () => { calls += 1; } };
  removeQuietly(sub);
  quietSubscription(sub).remove();
  removeQuietly(null);
  removeQuietly(undefined);
  assert.equal(calls, 2);
});
