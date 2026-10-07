/**
 * The withdraw form (`POST /api/wallet/withdraw`). The checks repeat the server's body schema, the
 * two sentences the device script waits for are pinned, the idempotency key follows the request it
 * belongs to, and a refusal always leads with the server's own sentence.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { PartnerApiError, networkError } from "../api-error.ts";
import { rupees } from "../money-format.ts";
import {
  createWithdrawKeyLedger,
  keyForRequest,
  parseAmount,
  settleRequest,
  validateWithdrawForm,
  verificationNotice,
  withdrawOutcome,
  withdrawPayload,
  withdrawRefusal,
  type WithdrawForm,
} from "../money-withdraw.ts";

const good: WithdrawForm = { amountText: "500", accountHolder: "Asha Verma", bankAccountNumber: "123456789012", ifscCode: "HDFC0001234" };

test("parseAmount: rupees with up to two decimals; anything else is not an amount", () => {
  assert.equal(parseAmount("500"), 500);
  assert.equal(parseAmount(" 1,250.50 "), 1250.5);
  assert.equal(parseAmount("0"), 0);
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("12.345"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("5e3"), null);
  assert.equal(parseAmount("abc"), null);
});

test("a complete form has no errors", () => {
  assert.deepEqual(validateWithdrawForm(good, 1000, rupees), {});
});

test("zero, empty or malformed amount: the sentence the device script waits for", () => {
  // e2e/native-android-section04-finance.ts VALID_AMOUNT_MSG
  for (const amountText of ["0", "", "abc", "1.234"]) {
    assert.equal(validateWithdrawForm({ ...good, amountText }, 1000, rupees).amountText, "Enter a valid amount", amountText);
  }
});

test("more than the available balance: says so, with the balance the server sent", () => {
  const error = validateWithdrawForm({ ...good, amountText: "1001" }, 1000, rupees).amountText;
  assert.equal(error, "Amount cannot exceed available balance (₹1,000)");
  // e2e/native-android-section04-finance.ts EXCEED_MSG
  assert.match(error ?? "", /cannot exceed available/i);
});

test("the whole available balance, paise included, can be asked for", () => {
  assert.deepEqual(validateWithdrawForm({ ...good, amountText: "1000.50" }, 1000.5, rupees), {});
});

test("bank details: the server's own format rules", () => {
  assert.equal(validateWithdrawForm({ ...good, accountHolder: " A " }, 1000, rupees).accountHolder, "Enter the account holder name");
  assert.equal(validateWithdrawForm({ ...good, bankAccountNumber: "12345678" }, 1000, rupees).bankAccountNumber, "Enter a valid bank account number");
  assert.equal(validateWithdrawForm({ ...good, bankAccountNumber: "1234567890123456789" }, 1000, rupees).bankAccountNumber, "Enter a valid bank account number");
  assert.equal(validateWithdrawForm({ ...good, bankAccountNumber: "12345678A" }, 1000, rupees).bankAccountNumber, "Enter a valid bank account number");
  assert.equal(validateWithdrawForm({ ...good, ifscCode: "HDFC1001234" }, 1000, rupees).ifscCode, "Enter a valid IFSC code");
  assert.equal(validateWithdrawForm({ ...good, ifscCode: "hdfc0001234" }, 1000, rupees).ifscCode, undefined);
});

test("every field is reported at once, each under its own field", () => {
  const errors = validateWithdrawForm({ amountText: "", accountHolder: "", bankAccountNumber: "", ifscCode: "" }, 1000, rupees);
  assert.deepEqual(Object.keys(errors).sort(), ["accountHolder", "amountText", "bankAccountNumber", "ifscCode"]);
});

test("withdrawPayload: the body the route's schema accepts", () => {
  assert.deepEqual(withdrawPayload({ amountText: "250.5", accountHolder: "  Asha Verma ", bankAccountNumber: "1234 5678 9012", ifscCode: " hdfc0001234 " }), {
    amount: 250.5,
    bankAccountNumber: "123456789012",
    ifscCode: "HDFC0001234",
    accountHolder: "Asha Verma",
  });
  assert.equal(withdrawPayload({ ...good, amountText: "0" }), null);
});

test("a balance the app has not just read is not used to refuse an amount — the server judges", () => {
  assert.deepEqual(validateWithdrawForm({ ...good, amountText: "999999" }, null, rupees), {});
  // The format checks still run without a balance.
  assert.equal(validateWithdrawForm({ ...good, amountText: "0" }, null, rupees).amountText, "Enter a valid amount");
  assert.equal(validateWithdrawForm({ ...good, ifscCode: "X" }, null, rupees).ifscCode, "Enter a valid IFSC code");
});

function counter() {
  let n = 0;
  return { generate: () => `key-${++n}`, count: () => n };
}

test("idempotency key: a retry of the same request reuses it", () => {
  const { generate, count } = counter();
  const ledger = createWithdrawKeyLedger();
  const payload = withdrawPayload(good)!;
  const first = keyForRequest(ledger, "u-1", payload, generate);
  const retry = keyForRequest(ledger, "u-1", payload, generate);
  assert.equal(first.key, "key-1");
  assert.equal(retry.key, "key-1");
  assert.equal(count(), 1);
});

test("idempotency key: a changed amount or account is a new request and gets a new key", () => {
  const { generate } = counter();
  const ledger = createWithdrawKeyLedger();
  const first = keyForRequest(ledger, "u-1", withdrawPayload(good)!, generate);
  const otherAmount = keyForRequest(ledger, "u-1", withdrawPayload({ ...good, amountText: "600" })!, generate);
  const otherAccount = keyForRequest(ledger, "u-1", withdrawPayload({ ...good, amountText: "600", bankAccountNumber: "999999999999" })!, generate);
  assert.deepEqual([first.key, otherAmount.key, otherAccount.key], ["key-1", "key-2", "key-3"]);
});

test("idempotency key: a lost answer keeps the key through close, reopen and a different request in between", () => {
  // The sheet holds nothing: the ledger outlives it. Close/reopen is simply "ask the ledger again".
  const { generate } = counter();
  const ledger = createWithdrawKeyLedger();
  const payload = withdrawPayload(good)!;
  const first = keyForRequest(ledger, "u-1", payload, generate);
  settleRequest(ledger, first.signature, withdrawOutcome(networkError()));
  // A different amount is tried in between, and is answered.
  const other = keyForRequest(ledger, "u-1", withdrawPayload({ ...good, amountText: "600" })!, generate);
  settleRequest(ledger, other.signature, withdrawOutcome(null));
  const again = keyForRequest(ledger, "u-1", payload, generate);
  assert.equal(again.key, first.key);
});

test("idempotency key: only a real answer retires it", () => {
  const payload = withdrawPayload(good)!;
  const cases: Array<[unknown, "answered" | "unknown"]> = [
    [null, "answered"], // success
    [new PartnerApiError("Insufficient wallet balance", { status: 400, code: "INSUFFICIENT_BALANCE" }), "answered"],
    [new PartnerApiError("Verify your email to continue", { status: 403, code: "EMAIL_NOT_VERIFIED" }), "answered"],
    [networkError(), "unknown"],
    // The route answers 500 AFTER creating the withdrawal when it cannot read it back.
    [new PartnerApiError("Withdrawal not found", { status: 500, code: "INTERNAL_ERROR" }), "unknown"],
    [new PartnerApiError("Bad gateway", { status: 502 }), "unknown"],
    [new Error("boom"), "unknown"],
    [undefined, "unknown"],
  ];
  for (const [error, expected] of cases) {
    assert.equal(withdrawOutcome(error), expected, String((error as Error | null)?.message ?? error));
    const { generate } = counter();
    const ledger = createWithdrawKeyLedger();
    const first = keyForRequest(ledger, "u-1", payload, generate);
    settleRequest(ledger, first.signature, withdrawOutcome(error));
    const next = keyForRequest(ledger, "u-1", payload, generate);
    assert.equal(next.key, expected === "answered" ? "key-2" : "key-1");
  }
});

test("idempotency key: another account on the same phone never inherits a key", () => {
  const { generate } = counter();
  const ledger = createWithdrawKeyLedger();
  const payload = withdrawPayload(good)!;
  const a = keyForRequest(ledger, "u-1", payload, generate);
  const b = keyForRequest(ledger, "u-2", payload, generate);
  assert.notEqual(a.key, b.key);
});

test("refusal: an unverified email keeps the server's sentence and names the action that exists", () => {
  const r = withdrawRefusal(new PartnerApiError("Verify your email to continue", { status: 403, code: "EMAIL_NOT_VERIFIED" }));
  assert.equal(r.kind, "email_unverified");
  assert.equal(r.sentence, "Verify your email to continue");
  assert.match(r.note ?? "", /verification link/);
  assert.doesNotMatch(r.note ?? "", /code|otp/i);
});

test("refusal: INSUFFICIENT_BALANCE shows the server's sentence and says it may not be the cause", () => {
  const r = withdrawRefusal(new PartnerApiError("Insufficient wallet balance", { status: 400, code: "INSUFFICIENT_BALANCE" }));
  assert.equal(r.kind, "insufficient_balance");
  assert.equal(r.sentence, "Insufficient wallet balance");
  assert.match(r.note ?? "", /same answer/);
});

test("refusal: validation details are the server's field messages", () => {
  const r = withdrawRefusal(new PartnerApiError("Validation failed", { status: 400, code: "VALIDATION_ERROR", details: ["Invalid IFSC format", "Amount too large"] }));
  assert.deepEqual(r, { kind: "refused", sentence: "Invalid IFSC format. Amount too large", note: null });
});

test("refusal: no connection is told apart from a refusal; the request may have landed, and a retry is safe", () => {
  const r = withdrawRefusal(networkError());
  assert.equal(r.kind, "offline");
  assert.equal(r.sentence, "You're offline. Check your connection and try again.");
  assert.match(r.note ?? "", /may still have reached the server/);
  assert.match(r.note ?? "", /Recent withdrawals/);
  assert.match(r.note ?? "", /cannot create a second withdrawal/);
});

test("refusal: a server error keeps the server's sentence and says the outcome is not confirmed", () => {
  const r = withdrawRefusal(new PartnerApiError("Withdrawal not found", { status: 500, code: "INTERNAL_ERROR" }));
  assert.equal(r.kind, "unconfirmed");
  assert.equal(r.sentence, "Withdrawal not found");
  assert.match(r.note ?? "", /Recent withdrawals/);
  assert.match(r.note ?? "", /cannot create a second withdrawal/);
});

test("refusal: any other server answer is shown unchanged; a non-API error keeps its message", () => {
  assert.deepEqual(withdrawRefusal(new PartnerApiError("Too many requests", { status: 429, code: "RATE_LIMIT_EXCEEDED" })), {
    kind: "refused",
    sentence: "Too many requests",
    note: null,
  });
  assert.equal(withdrawRefusal(new Error("boom")).sentence, "boom");
  assert.equal(withdrawRefusal(undefined).sentence, "The withdrawal could not be requested.");
});

test("verification link: an answer that names an address says where it went, in the server's sentence", () => {
  const n = verificationNotice({ message: "Verification email sent", email: "asha@example.com", expiresAt: "2026-10-08T10:00:00.000Z" }, (iso) => `<${iso}>`);
  assert.equal(n.sent, true);
  assert.equal(n.title, "Verification email sent");
  assert.match(n.message, /Sent to asha@example\.com\./);
  assert.match(n.message, /<2026-10-08T10:00:00\.000Z>/);
});

test("verification link: no address on the account means nothing was sent — never claim an email", () => {
  // The route answers success with `email: null` and sends nothing (backend routes/auth.ts).
  for (const email of [null, "", "   ", undefined]) {
    const n = verificationNotice({ message: "Verification email sent", email, expiresAt: "2026-10-08T10:00:00.000Z" }, (iso) => iso);
    assert.equal(n.sent, false, String(email));
    assert.doesNotMatch(`${n.title} ${n.message}`, /sent|open the link/i);
    assert.match(n.title, /no email address/i);
    assert.match(n.message, /support/i);
  }
});
