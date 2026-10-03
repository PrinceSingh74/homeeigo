/**
 * Phase 10 §11 partner app: the warranty line on a completed job.
 *
 * Run: `node --test src/lib/__tests__/warranty.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { warrantyLine } from "../warranty.ts";

const fmt = (iso: string) => iso.slice(0, 10);
const NOW = new Date("2026-09-29T00:00:00.000Z");
const W = { state: "ACTIVE", startsAt: "2026-09-28T19:30:07.855Z", expiresAt: "2026-10-05T19:30:07.855Z" };

test("active warranty inside its window: covered until the expiry", () => {
  assert.equal(warrantyLine(W, NOW, fmt), "Warranty: covered until 2026-10-05.");
});

test("no warranty row (service without warrantyDays, or not completed yet): nothing is shown", () => {
  assert.equal(warrantyLine(null, NOW, fmt), null);
  assert.equal(warrantyLine(undefined, NOW, fmt), null);
});

test("expired warranty, or an ACTIVE row whose window has passed before the sweeper ran: ended", () => {
  assert.equal(warrantyLine({ ...W, state: "EXPIRED" }, NOW, fmt), "Warranty ended on 2026-10-05.");
  assert.equal(warrantyLine(W, new Date("2026-10-06T00:00:00.000Z"), fmt), "Warranty ended on 2026-10-05.");
});

test("void warranty: says it no longer applies, never 'covered'", () => {
  assert.equal(warrantyLine({ ...W, state: "VOID" }, NOW, fmt), "Warranty no longer applies to this job.");
});

test("unknown state or unparseable expiry: nothing is claimed", () => {
  assert.equal(warrantyLine({ ...W, state: "SOMETHING_NEW" }, NOW, fmt), null);
  assert.equal(warrantyLine({ ...W, expiresAt: "not-a-date" }, NOW, fmt), null);
});
