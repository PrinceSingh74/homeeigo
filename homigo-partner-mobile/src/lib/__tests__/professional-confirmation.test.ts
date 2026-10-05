/**
 * Partner app: the professional confirmation at completion.
 *
 * Run: `node --test src/lib/__tests__/professional-confirmation.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCompleteConfirmation,
  CONFIRMATION_MISSING_HINT,
  confirmationRequired,
  describeConfirmationRefusal,
  PROFESSIONAL_CONFIRMATION_LABEL,
  professionalConfirmationFor,
  QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED,
} from "../professional-confirmation.ts";

test("required only when the frozen policy says so, or the server demanded it", () => {
  assert.equal(confirmationRequired({ professionalConfirmation: true }), true);
  assert.equal(confirmationRequired({ professionalConfirmation: false }), false);
  assert.equal(confirmationRequired({}), false);
  assert.equal(confirmationRequired(null), false);
  assert.equal(confirmationRequired(undefined), false);
  // A truthy non-boolean is not the policy flag.
  assert.equal(confirmationRequired({ professionalConfirmation: "true" as unknown as boolean }), false);
  // The server refused: the row is required even though the booking copy did not carry the flag.
  assert.equal(confirmationRequired(null, true), true);
  assert.equal(confirmationRequired({ professionalConfirmation: false }, true), true);
});

test("required and unticked: Complete is blocked with an explanation", () => {
  const gate = canCompleteConfirmation(true, false);
  assert.equal(gate.allowed, false);
  assert.equal(gate.hint, CONFIRMATION_MISSING_HINT);
  assert.match(gate.hint!, /completion criteria/i);
});

test("required and ticked, or not required: Complete is allowed", () => {
  assert.deepEqual(canCompleteConfirmation(true, true), { allowed: true, hint: null });
  assert.deepEqual(canCompleteConfirmation(false, false), { allowed: true, hint: null });
  assert.deepEqual(canCompleteConfirmation(false, true), { allowed: true, hint: null });
});

test("the wire value is true only when required AND ticked — otherwise the key is omitted", () => {
  assert.equal(professionalConfirmationFor(true, true), true);
  assert.equal(professionalConfirmationFor(true, false), undefined);
  assert.equal(professionalConfirmationFor(false, false), undefined);
  // No row was shown, so nothing the partner ticked exists to send.
  assert.equal(professionalConfirmationFor(false, true), undefined);
  // The key disappears from a JSON body rather than travelling as `false`.
  assert.equal(JSON.stringify({ professionalConfirmation: professionalConfirmationFor(true, false) }), "{}");
});

test("the server's refusal is recognised and names the row to tick", () => {
  const refusal = describeConfirmationRefusal(QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED, "Confirm the completion criteria were met before finishing this job");
  assert.equal(refusal.confirmationRefused, true);
  assert.ok(refusal.message.includes(PROFESSIONAL_CONFIRMATION_LABEL));
});

test("any other failure is left to the generic handler with its own message", () => {
  assert.deepEqual(describeConfirmationRefusal("QUALITY_CHECKLIST_REQUIRED", "Complete the service checklist"), {
    confirmationRefused: false,
    message: "Complete the service checklist",
  });
  assert.deepEqual(describeConfirmationRefusal(null, null), { confirmationRefused: false, message: "Complete failed" });
});
