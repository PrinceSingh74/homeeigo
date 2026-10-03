import { test } from "node:test";
import assert from "node:assert/strict";
import { completeBody, completePlan, stepMetaLabel } from "../step-evidence.ts";

// X-57: a finished step must not keep asking for evidence.
test("a finished PHOTO step reads 'photo added', not 'needs photo evidence'", () => {
  assert.equal(stepMetaLabel("COMPLETED", "PHOTO"), "Done · photo added");
  assert.equal(stepMetaLabel("COMPLETED", "BEFORE_AFTER_PHOTOS"), "Done · before & after photos added");
  assert.equal(stepMetaLabel("COMPLETED", "NOTE"), "Done · note added");
  assert.equal(stepMetaLabel("COMPLETED", "NONE"), "Done");
});

test("an open step says what it needs", () => {
  assert.equal(stepMetaLabel("IN_PROGRESS", "PHOTO"), "In progress · needs a photo");
  assert.equal(stepMetaLabel("READY", "BEFORE_AFTER_PHOTOS"), "Ready · needs before & after photos");
  assert.equal(stepMetaLabel("PENDING", "NOTE"), "Not started · needs a note");
  assert.equal(stepMetaLabel("READY", "NONE"), "Ready");
});

test("skipped, failed and escalated steps ask for nothing", () => {
  assert.equal(stepMetaLabel("SKIPPED_WITH_REASON", "PHOTO"), "Skipped");
  assert.equal(stepMetaLabel("FAILED", "BEFORE_AFTER_PHOTOS"), "Failed");
  assert.equal(stepMetaLabel("ESCALATED", "NOTE"), "Escalated");
});

// The server (booking-execution.service): before = an ARRIVAL/START photo, after = a COMPLETION photo;
// a PHOTO step needs the id of a real photo; a NOTE step needs the note.
test("a BEFORE_AFTER_PHOTOS step asks for a before photo (START) then an after photo (COMPLETION)", () => {
  const p = completePlan("BEFORE_AFTER_PHOTOS");
  assert.deepEqual(p.photos.map((x) => x.stage), ["START", "COMPLETION"]);
  assert.equal(p.note, false);
  assert.match(p.buttonLabel, /before & after/i);
});

test("a PHOTO step asks for one photo; a NOTE step for a note; NONE for nothing", () => {
  assert.deepEqual(completePlan("PHOTO").photos.map((x) => x.stage), ["START"]);
  assert.equal(completePlan("NOTE").note, true);
  assert.deepEqual(completePlan("NOTE").photos, []);
  assert.deepEqual(completePlan("NONE"), { note: false, photos: [], buttonLabel: "Done" });
});

test("the complete body carries the LAST uploaded photo (the after photo) and the note, nothing invented", () => {
  assert.deepEqual(completeBody(completePlan("BEFORE_AFTER_PHOTOS"), ["ev-before", "ev-after"]), { evidenceId: "ev-after" });
  assert.deepEqual(completeBody(completePlan("PHOTO"), ["ev-1"]), { evidenceId: "ev-1" });
  assert.deepEqual(completeBody(completePlan("NOTE"), [], "  Scope agreed  "), { note: "Scope agreed" });
  assert.deepEqual(completeBody(completePlan("NONE"), []), {});
});
