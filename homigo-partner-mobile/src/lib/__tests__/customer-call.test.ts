import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CUSTOMER_CALL_AVAILABLE, CUSTOMER_CALL_UNAVAILABLE_NOTE, customerCallLabel } from "../customer-call.ts";

/**
 * X-28 — owner decision 2026-09-29 (privacy first): a partner never receives the customer's full phone
 * number; with no masked-call relay the backend withholds direct calls (409 CALL_RELAY_UNAVAILABLE) and
 * the app points the partner at in-app chat instead of dialling.
 */
test("calling the customer is unavailable and the partner is pointed at chat", () => {
  assert.equal(CUSTOMER_CALL_AVAILABLE, false);
  assert.match(CUSTOMER_CALL_UNAVAILABLE_NOTE, /chat/i);
  assert.equal(customerCallLabel("+91 •••• 3210"), "Call +91 •••• 3210 · unavailable");
  assert.equal(customerCallLabel(null), "Call · unavailable");
});

test("no partner screen dials a number returned by the call endpoint", () => {
  const src = join(import.meta.dirname, "..", "..");
  for (const rel of ["screens/JobDetailScreen.tsx", "components/JobLifecycleActions.tsx"]) {
    const text = readFileSync(join(src, rel), "utf8");
    assert.doesNotMatch(text, /initiateCall\(/, `${rel} still calls initiateCall`);
    assert.doesNotMatch(text, /dialUri/, `${rel} still dials a returned number`);
  }
});
