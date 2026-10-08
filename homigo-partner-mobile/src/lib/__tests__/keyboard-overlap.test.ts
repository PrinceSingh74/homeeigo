/**
 * Found on the Android emulator 2026-10-08 (first device run of the rebuilt app). React Native's
 * `KeyboardAvoidingView` reads `endCoordinates.screenY` from BOTH keyboard events. On Android the
 * "did hide" event carries the HEIGHT of the visible frame there (the screen less the status and
 * navigation bars), not a position: with edge-to-edge that is above the bottom of every full-height
 * view, so after the keyboard closed a sheet stayed 48 pt above the bottom edge and a screen's docked
 * footer stayed 24 pt above its place — for as long as the screen lived.
 *
 * The rule the app's own avoider follows instead: no keyboard, no padding; a keyboard pads by how far
 * it really covers the view, and never by a negative or a non-number.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { keyboardOverlap } from "../keyboard-overlap.ts";

test("a hidden keyboard never pads, whatever position the event claims", () => {
  // The values the emulator sent on hide: screenY 866.29 for a view whose bottom is at 914.29.
  assert.equal(keyboardOverlap({ visible: false, viewBottom: 914.29, keyboardTop: 866.29 }), 0);
  assert.equal(keyboardOverlap({ visible: false, viewBottom: 890.29, keyboardTop: 866.29 }), 0);
});

test("a visible keyboard pads by how far it covers the view", () => {
  // Text keyboard on the emulator: top at 578 pt; a sheet reaching the bottom of a 914 pt screen.
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 914, keyboardTop: 578 }), 336);
  // A screen whose frame already stops above the navigation bar is padded by less.
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 890, keyboardTop: 578 }), 312);
});

test("a keyboard that does not reach the view adds nothing", () => {
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 500, keyboardTop: 578 }), 0);
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 578, keyboardTop: 578 }), 0);
});

test("an unmeasured view or a broken event adds nothing rather than a guess", () => {
  assert.equal(keyboardOverlap({ visible: true, viewBottom: null, keyboardTop: 578 }), 0);
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 914, keyboardTop: undefined }), 0);
  assert.equal(keyboardOverlap({ visible: true, viewBottom: Number.NaN, keyboardTop: 578 }), 0);
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 914, keyboardTop: Number.POSITIVE_INFINITY }), 0);
});

test("the padding is a whole number of points", () => {
  assert.equal(keyboardOverlap({ visible: true, viewBottom: 914.2857, keyboardTop: 578.6 }), 336);
});
