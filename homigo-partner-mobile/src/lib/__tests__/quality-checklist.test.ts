/**
 * W2-D1 partner app: the completion checklist submission.
 *
 * Run: `node --test src/lib/__tests__/quality-checklist.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCompleteBookingBody,
  canCompleteChecklist,
  completedChecklistFor,
  describeChecklistRefusal,
  missingChecklistItems,
  QUALITY_CHECKLIST_REQUIRED,
  toggleChecklistItem,
} from "../quality-checklist.ts";

const CHECKLIST = ["Wipe surfaces", "Mop floor", "Empty bins"];

test("all ticked: allowed, body carries every item in checklist order", () => {
  const ticked = ["Empty bins", "Wipe surfaces", "Mop floor"]; // tapped out of order
  const gate = canCompleteChecklist(CHECKLIST, ticked);
  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.missing, []);
  assert.equal(gate.hint, null);

  const body = buildCompleteBookingBody({ latitude: 12.9, longitude: 77.6, photos: ["data:image/jpeg;base64,x"], checklist: CHECKLIST, ticked });
  assert.deepEqual(body, {
    latitude: 12.9,
    longitude: 77.6,
    photos: ["data:image/jpeg;base64,x"],
    completedChecklist: ["Wipe surfaces", "Mop floor", "Empty bins"],
  });
});

test("one unticked: not allowed, that item named, body carries only the ticked items", () => {
  const ticked = ["Wipe surfaces", "Empty bins"];
  const gate = canCompleteChecklist(CHECKLIST, ticked);
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing, ["Mop floor"]);
  assert.match(gate.hint ?? "", /1 of 3 left/);
  assert.deepEqual(missingChecklistItems(CHECKLIST, ticked), ["Mop floor"]);

  // Never an all-ticked list the partner did not tick.
  const body = buildCompleteBookingBody({ latitude: null, longitude: null, checklist: CHECKLIST, ticked });
  assert.deepEqual(body, { completedChecklist: ["Wipe surfaces", "Empty bins"] });
  assert.equal("latitude" in body, false);
});

test("nothing ticked on a non-empty checklist: every item missing; wire value is an empty list", () => {
  const gate = canCompleteChecklist(CHECKLIST, []);
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.missing, CHECKLIST);
  assert.deepEqual(completedChecklistFor(CHECKLIST, []), []);
});

test("empty checklist: allowed and the body has no completedChecklist key", () => {
  const gate = canCompleteChecklist([], []);
  assert.equal(gate.allowed, true);
  assert.equal(gate.hint, null);
  assert.equal(completedChecklistFor([], []), undefined);

  const body = buildCompleteBookingBody({ latitude: 1, longitude: 2, notes: "done", checklist: [], ticked: [] });
  assert.deepEqual(body, { latitude: 1, longitude: 2, notes: "done" });
  assert.equal("completedChecklist" in body, false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "completedChecklist"), false);
});

test("strings not on the frozen checklist are never sent and cannot be ticked", () => {
  assert.deepEqual(completedChecklistFor(CHECKLIST, ["Mop floor", "Paint walls"]), ["Mop floor"]);
  assert.deepEqual(toggleChecklistItem(CHECKLIST, ["Mop floor"], "Paint walls"), ["Mop floor"]);
  assert.deepEqual(toggleChecklistItem(CHECKLIST, ["Mop floor"], "Empty bins"), ["Mop floor", "Empty bins"]);
  assert.deepEqual(toggleChecklistItem(CHECKLIST, ["Mop floor", "Empty bins"], "Mop floor"), ["Empty bins"]);
});

test("refusal mapping: QUALITY_CHECKLIST_REQUIRED marks the server-named items as still needed", () => {
  const r = describeChecklistRefusal(QUALITY_CHECKLIST_REQUIRED, "Complete the service checklist before finishing this job", CHECKLIST, [
    "mop floor ", // server fold: trimmed + case-folded still lands on the frozen row
    "Empty bins",
  ]);
  assert.equal(r.checklistRefused, true);
  assert.deepEqual(r.stillNeeded, ["Mop floor", "Empty bins"]);
  assert.match(r.message, /checklist is not complete/);
  assert.match(r.message, /Mop floor, Empty bins/);
});

test("refusal mapping: no usable server detail falls back to every item; other codes are not checklist refusals", () => {
  const all = describeChecklistRefusal(QUALITY_CHECKLIST_REQUIRED, "x", CHECKLIST, null);
  assert.equal(all.checklistRefused, true);
  assert.deepEqual(all.stillNeeded, CHECKLIST);

  const unknown = describeChecklistRefusal(QUALITY_CHECKLIST_REQUIRED, "x", CHECKLIST, ["Something else"]);
  assert.deepEqual(unknown.stillNeeded, CHECKLIST);

  const other = describeChecklistRefusal("QUALITY_PROOF_REQUIRED", "Required job proof is missing", CHECKLIST, ["Mop floor"]);
  assert.equal(other.checklistRefused, false);
  assert.equal(other.message, "Required job proof is missing");
  assert.deepEqual(other.stillNeeded, []);

  const network = describeChecklistRefusal(null, undefined, CHECKLIST);
  assert.equal(network.checklistRefused, false);
  assert.equal(network.message, "Complete failed");
});
