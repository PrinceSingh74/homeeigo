/**
 * Found on the Android emulator 2026-10-08 (second device run). When a note field low on the job
 * page took focus, the OS scrolled the FIELD into view above the keyboard, but the "Confirm" button
 * under it stayed hidden behind the docked footer (which the keyboard avoider keeps above the
 * keyboard): the partner could type and then had to close the keyboard or scroll to find the button.
 * The requirement note showed it (field at 934–1186 px, Confirm at 1208–1345 px, visible area ending
 * at 1265 px); the step note, higher on the page, did not.
 *
 * The rule: after the keyboard is up, scroll by just enough that the field AND an allowance for the
 * control under it clear the visible area's bottom edge — never more than would push the field's top
 * out at the top, never when everything already fits, never on a non-number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { revealScrollDelta } from "../keyboard-reveal.ts";

test("a field whose confirm button is under the footer scrolls by the overlap", () => {
  // The requirement note on the emulator, in dp (px / 2.625): field 356–452, allowance 60, visible bottom 482.
  assert.equal(revealScrollDelta({ viewTop: 356, viewBottom: 452, allowanceBelow: 60, visibleTop: 24, visibleBottom: 482 }), 30);
});

test("a field that already fits with its button scrolls nothing", () => {
  // The step note: field 166–262, confirm ends at 347, visible bottom 514.
  assert.equal(revealScrollDelta({ viewTop: 166, viewBottom: 262, allowanceBelow: 60, visibleTop: 24, visibleBottom: 514 }), 0);
});

test("the scroll never pushes the field's top above the visible area", () => {
  // A tall field: moving it fully would hide its label; move only as far as the top edge allows.
  assert.equal(revealScrollDelta({ viewTop: 40, viewBottom: 460, allowanceBelow: 60, visibleTop: 24, visibleBottom: 300 }), 16);
  // Already at the top: nothing to gain.
  assert.equal(revealScrollDelta({ viewTop: 24, viewBottom: 460, allowanceBelow: 60, visibleTop: 24, visibleBottom: 300 }), 0);
});

test("a missing or non-finite measurement scrolls nothing", () => {
  assert.equal(revealScrollDelta({ viewTop: Number.NaN, viewBottom: 452, allowanceBelow: 60, visibleTop: 24, visibleBottom: 482 }), 0);
  assert.equal(revealScrollDelta({ viewTop: 356, viewBottom: 452, allowanceBelow: 60, visibleTop: 24, visibleBottom: null }), 0);
  assert.equal(revealScrollDelta({ viewTop: 356, viewBottom: 452, allowanceBelow: 60, visibleTop: undefined, visibleBottom: 482 }), 0);
});

test("the result is a whole number of points", () => {
  assert.equal(revealScrollDelta({ viewTop: 356.4, viewBottom: 452.3, allowanceBelow: 60, visibleTop: 24, visibleBottom: 482.1 }), 30);
});
