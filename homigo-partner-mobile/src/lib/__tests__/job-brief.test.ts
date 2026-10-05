/**
 * Partner app: the job screen's Materials / Equipment cards and durations.
 *
 * Run: `node --test src/lib/__tests__/job-brief.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMinutes, stepItemsNotListed, uniqueStepItems } from "../job-brief.ts";

test("minutes read as minutes, then hours", () => {
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(60), "1 hr");
  assert.equal(formatMinutes(95), "1 hr 35 min");
});

test("step items: distinct, in step order, first spelling kept", () => {
  const steps = [
    { materials: ["Descaler", "Microfibre cloth"], equipment: ["Ladder"] },
    { materials: ["microfibre cloth ", "Sealant"], equipment: [] },
    { materials: [""] },
  ];
  assert.deepEqual(uniqueStepItems(steps, "materials"), ["Descaler", "Microfibre cloth", "Sealant"]);
  assert.deepEqual(uniqueStepItems(steps, "equipment"), ["Ladder"]);
});

test("steps from an older server build carry no lists — absent means none", () => {
  assert.deepEqual(uniqueStepItems([{}, { materials: null }], "materials"), []);
  assert.deepEqual(uniqueStepItems(undefined, "equipment"), []);
  assert.deepEqual(uniqueStepItems(null, "materials"), []);
});

test("a step item already named by a preparation line is not listed twice", () => {
  assert.deepEqual(stepItemsNotListed(["Descaler", "Sealant"], ["descaler "]), ["Sealant"]);
  assert.deepEqual(stepItemsNotListed(["Ladder"], []), ["Ladder"]);
});
