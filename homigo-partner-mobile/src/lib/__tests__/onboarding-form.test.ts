/**
 * Partner sign-up form rules: the checks the form ran before stay the same checks (only their
 * words changed), the step indicator says where the applicant is, and a request that got no answer
 * is told apart from the server's own refusal.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ONBOARDING_LIMITS,
  accountAwaitsOtp,
  digitsOnly,
  registrationErrorSentence,
  stepIndicatorText,
  stepPosition,
  validateAccount,
  validateKyc,
  validateProfile,
} from "../onboarding-form.ts";
import { OFFLINE_SENTENCE } from "../error-sentence.ts";

const account = { firstName: "Rahul", lastName: "Sharma", phoneNumber: "9876543210", password: "Abcdef1!", confirmPassword: "Abcdef1!" };

// Found on the Android emulator 2026-10-08: Back from the OTP step, then "Send OTP & create
// account" again, asked the server to create the account a second time — it answered "Email
// already registered" and the applicant could neither go on nor start over. The account made in
// this sitting is still waiting for its OTP; the form goes back to that step instead.
test("an account already created in this sitting goes back to its OTP step, not to a second create", () => {
  const created = { email: "rahul@example.com", phoneNumber: "9876543210" };
  assert.equal(accountAwaitsOtp(created, "rahul@example.com", "9876543210"), true);
  assert.equal(accountAwaitsOtp(created, "  Rahul@Example.com ", "9876543210"), true);
  // A changed email or mobile is a different account: the server decides about that one.
  assert.equal(accountAwaitsOtp(created, "other@example.com", "9876543210"), false);
  assert.equal(accountAwaitsOtp(created, "rahul@example.com", "9876500000"), false);
  // Nothing was created yet.
  assert.equal(accountAwaitsOtp(null, "rahul@example.com", "9876543210"), false);
});

test("a complete account form has no errors", () => {
  assert.deepEqual(validateAccount(account, "rahul@example.com"), {});
});

test("account: each rule the form had still refuses, in plain words, under its own field", () => {
  const errors = validateAccount({ firstName: " R ", lastName: "", phoneNumber: "98765", password: "short", confirmPassword: "other" }, "not-an-email");
  assert.deepEqual(Object.keys(errors).sort(), ["confirmPassword", "email", "firstName", "lastName", "password", "phoneNumber"]);
  assert.equal(errors.firstName, "Enter your first name (at least 2 letters).");
  assert.equal(errors.lastName, "Enter your last name (at least 2 letters).");
  assert.equal(errors.email, "Enter a valid email address.");
  assert.equal(errors.phoneNumber, "Enter your 10-digit mobile number.");
  assert.equal(errors.password, "Use at least 8 characters.");
  assert.equal(errors.confirmPassword, "The two passwords do not match.");
});

test("account: the rules are not tightened beyond what the form checked before", () => {
  // The server also wants upper, lower, digit and symbol; that refusal stays the server's to give.
  assert.deepEqual(validateAccount({ ...account, password: "abcdefgh", confirmPassword: "abcdefgh" }, "a@b.co"), {});
});

test("profile: date shape, gender, contact name and 10-digit phone", () => {
  assert.deepEqual(validateProfile({ dateOfBirth: "1992-04-12", gender: "male", emergencyName: "Priya", emergencyPhone: "9876543210" }), {});
  const errors = validateProfile({ dateOfBirth: "12/04/1992", gender: "", emergencyName: "P", emergencyPhone: "12345" });
  assert.equal(errors.dateOfBirth, "Write the date as YYYY-MM-DD, for example 1992-04-12.");
  assert.equal(errors.gender, "Choose one.");
  assert.equal(errors.emergencyName, "Enter your emergency contact's name.");
  assert.equal(errors.emergencyPhone, "Enter a 10-digit mobile number.");
});

test("KYC: empty is allowed, a filled PAN or Aadhaar must have the server's shape", () => {
  assert.deepEqual(validateKyc({ panNumber: "", aadharNumber: "" }), {});
  assert.deepEqual(validateKyc({ panNumber: "abcde1234f", aadharNumber: "123456789012" }), {});
  const errors = validateKyc({ panNumber: "ABC", aadharNumber: "1234" });
  assert.equal(errors.panNumber, "A PAN is 5 letters, 4 digits and 1 letter, for example AAAAA1234B.");
  assert.equal(errors.aadharNumber, "An Aadhaar number is 12 digits.");
});

test("the step indicator numbers the ten steps and names the current one", () => {
  assert.deepEqual(stepPosition("account"), { number: 1, total: 10, label: "Account" });
  assert.deepEqual(stepPosition("otp"), { number: 1, total: 10, label: "Verification" });
  assert.deepEqual(stepPosition("documents"), { number: 7, total: 10, label: "Documents" });
  assert.deepEqual(stepPosition("review"), { number: 10, total: 10, label: "Review" });
  assert.equal(stepIndicatorText("services"), "Step 2 of 10 · Services");
});

test("welcome and done are not steps of the sequence", () => {
  assert.equal(stepPosition("welcome"), null);
  assert.equal(stepPosition("done"), null);
  assert.equal(stepIndicatorText("done"), null);
});

test("a request with no HTTP answer is the offline sentence, never the runtime's wording", () => {
  assert.equal(registrationErrorSentence(new TypeError("Network request failed"), "x"), OFFLINE_SENTENCE);
  assert.equal(registrationErrorSentence(new TypeError("Failed to fetch"), "x"), OFFLINE_SENTENCE);
  assert.equal(registrationErrorSentence(new Error("Could not reach backend"), "x"), OFFLINE_SENTENCE);
});

test("the server's sentence is shown unchanged", () => {
  assert.equal(registrationErrorSentence(new Error("Service radius must be between 1 and 50 km"), "x"), "Service radius must be between 1 and 50 km");
  assert.equal(registrationErrorSentence(new Error("Too many OTP attempts"), "x"), "Too many OTP attempts");
});

test("an answer that was not JSON, or nothing usable, falls back to the screen's own sentence", () => {
  assert.equal(registrationErrorSentence(new SyntaxError("JSON Parse error: Unexpected character: <"), "Could not save."), "Could not save.");
  assert.equal(registrationErrorSentence(new Error(""), "Could not save."), "Could not save.");
  assert.equal(registrationErrorSentence("boom", "Could not save."), "Could not save.");
});

test("digitsOnly keeps digits up to the limit", () => {
  assert.equal(digitsOnly("+91 98765-43210", 10), "9198765432");
  assert.equal(digitsOnly("12a", 2), "12");
});

test("limits are the server's schema, or the field's own fixed format", () => {
  assert.deepEqual(ONBOARDING_LIMITS, {
    name: 50,
    phone: 10,
    password: 128,
    otp: 6,
    city: 80,
    experienceYears: 2,
    radiusKm: 2,
    time: 5,
    dateOfBirth: 10,
    emergencyName: 100,
    pan: 10,
    aadhaar: 12,
    bankAccount: 18,
    bankHolder: 100,
    ifsc: 11,
    bankName: 100,
  });
});
