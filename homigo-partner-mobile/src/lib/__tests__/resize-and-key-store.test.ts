/**
 * Two rules added after the device-readiness review:
 *  - a job photo is shrunk on the phone before it is checked, so a high-megapixel camera cannot make
 *    a photo the server refuses;
 *  - a withdrawal's idempotency key survives the app being killed, so a lost answer cannot become a
 *    second withdrawal after a restart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EVIDENCE_RESIZE_LONG_EDGE, resizeTarget } from "../evidence-photo.ts";
import { createWithdrawKeyLedger, decodeWithdrawKeys, encodeWithdrawKeys, keyForRequest, WITHDRAW_KEY_TTL_MS } from "../money-withdraw.ts";

test("a photo larger than the long-edge limit is scaled down on its long edge, keeping its shape", () => {
  assert.deepEqual(resizeTarget(8000, 6000), { width: EVIDENCE_RESIZE_LONG_EDGE });
  assert.deepEqual(resizeTarget(6000, 8000), { height: EVIDENCE_RESIZE_LONG_EDGE });
  assert.deepEqual(resizeTarget(4000, 4000), { width: EVIDENCE_RESIZE_LONG_EDGE });
});

test("a photo already within the limit is not resized (never scaled UP), and unknown sizes are left alone", () => {
  assert.equal(resizeTarget(EVIDENCE_RESIZE_LONG_EDGE, 1200), null);
  assert.equal(resizeTarget(1200, 900), null);
  assert.equal(resizeTarget(0, 0), null);
  assert.equal(resizeTarget(undefined, undefined), null);
  assert.equal(resizeTarget(Number.NaN, 3000), null);
});

const payload = { amount: 500, bankAccountNumber: "123456789012", ifscCode: "HDFC0001234", accountHolder: "Asha Rao" };

test("a key owed an answer comes back after the app is restarted, for the same request only", () => {
  const before = createWithdrawKeyLedger();
  const first = keyForRequest(before, "user-1", payload, () => "key-A");
  const stored = encodeWithdrawKeys(before, new Map(), 1_000);

  // A new process: an empty ledger, filled from what was stored.
  const after = createWithdrawKeyLedger();
  const stamps = decodeWithdrawKeys(stored, after, 2_000);
  assert.equal(stamps.get(first.signature), 1_000);
  assert.equal(keyForRequest(after, "user-1", payload, () => "key-NEW").key, "key-A");
  // A different amount is a different request and gets its own key.
  assert.equal(keyForRequest(after, "user-1", { ...payload, amount: 600 }, () => "key-B").key, "key-B");
});

test("a stored key keeps its first timestamp across saves and is dropped once it is too old to matter", () => {
  const ledger = createWithdrawKeyLedger();
  const { signature } = keyForRequest(ledger, "user-1", payload, () => "key-A");
  const stamps = decodeWithdrawKeys(encodeWithdrawKeys(ledger, new Map(), 1_000), createWithdrawKeyLedger(), 1_500);
  // Saved again later: the age is counted from the first save, not the latest.
  const again = encodeWithdrawKeys(ledger, stamps, 9_000);
  const fresh = createWithdrawKeyLedger();
  assert.equal(decodeWithdrawKeys(again, fresh, 10_000).get(signature), 1_000);
  const expired = createWithdrawKeyLedger();
  decodeWithdrawKeys(again, expired, 1_000 + WITHDRAW_KEY_TTL_MS + 1);
  assert.equal(expired.size, 0);
});

test("unreadable stored text restores nothing and does not throw", () => {
  for (const text of [null, "", "not json", "[]", "{\"a\":1}", "{\"a\":{\"key\":5,\"at\":1}}"]) {
    const ledger = createWithdrawKeyLedger();
    assert.doesNotThrow(() => decodeWithdrawKeys(text, ledger, 1));
    assert.equal(ledger.size, 0);
  }
});
