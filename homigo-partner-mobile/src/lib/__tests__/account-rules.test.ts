/**
 * Account rules: the role is shown as what it means, the password rule is the server's, documents
 * are checked the way the upload endpoint checks them, support drafts match the route's schema.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_MAX_BYTES,
  SAFETY_REPORT_TYPES,
  SUPPORT_CATEGORIES,
  base64Bytes,
  canReply,
  changePasswordError,
  checkDocumentFile,
  dialable,
  documentState,
  documentTitle,
  fullName,
  isOwnMessage,
  isoDateOrNull,
  passwordProblems,
  roleLabel,
  safetyTypeLabel,
  sessionTitle,
  sniffDocumentImage,
  sortSessions,
  supportDraftErrors,
  ticketStatusLabel,
} from "../account-rules.ts";

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64");
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0x7f, 0x01, 0x00]), Buffer.from("WEBPVP8 ")]).toString("base64");
const PDF = Buffer.from("%PDF-1.7 something").toString("base64");

test("VENDOR is shown as Partner; a role the server did not send is not shown", () => {
  assert.equal(roleLabel("VENDOR"), "Partner");
  assert.equal(roleLabel(undefined), null);
  assert.equal(roleLabel("SOMETHING"), null);
  assert.equal(fullName(" Asha ", null), "Asha");
  assert.equal(fullName(null, ""), null);
});

test("the password rule is the server's: 8–128, upper, lower, digit, special", () => {
  assert.deepEqual(passwordProblems("Str0ng!pass"), []);
  assert.deepEqual(passwordProblems("short"), ["at least 8 characters", "an uppercase letter", "a number", "a special character"]);
  assert.equal(changePasswordError({ current: "", next: "Str0ng!pass", confirm: "Str0ng!pass" }), "Enter your current password.");
  assert.match(changePasswordError({ current: "Old#12345", next: "weakpass", confirm: "weakpass" }) ?? "", /uppercase/);
  assert.match(changePasswordError({ current: "Str0ng!pass", next: "Str0ng!pass", confirm: "Str0ng!pass" }) ?? "", /different/);
  assert.match(changePasswordError({ current: "Old#12345", next: "Str0ng!pass", confirm: "Str0ng!pasz" }) ?? "", /do not match/);
  assert.equal(changePasswordError({ current: "Old#12345", next: "Str0ng!pass", confirm: "Str0ng!pass" }), null);
});

test("sessions: this device first and named as such; no invented device names", () => {
  const rows = [
    { id: "a", deviceName: "Chrome", isCurrent: false, lastActivityAt: "2026-10-07T10:00:00Z", createdAt: "2026-10-01T00:00:00Z" },
    { id: "b", deviceName: null, isCurrent: true, lastActivityAt: null, createdAt: "2026-09-01T00:00:00Z" },
    { id: "c", deviceName: null, isCurrent: false, lastActivityAt: "2026-10-07T12:00:00Z", createdAt: "2026-10-02T00:00:00Z" },
  ];
  assert.deepEqual(sortSessions(rows).map((s) => s.id), ["b", "c", "a"]);
  assert.equal(sessionTitle(rows[1]!), "This device");
  assert.equal(sessionTitle(rows[2]!), "Unnamed device");
  assert.equal(sessionTitle({ deviceName: "HOMEEIGO Partner · android", isCurrent: true }), "HOMEEIGO Partner · android (this device)");
});

test("a support draft follows the route's schema; categories are the partner web app's six", () => {
  assert.equal(SUPPORT_CATEGORIES.length, 6);
  for (const c of SUPPORT_CATEGORIES) assert.ok(c.length >= 2 && c.length <= 80);
  assert.deepEqual(supportDraftErrors({ subject: "Payout missing", description: "My payout from Monday has not arrived.", category: "Payout issue", bookingRef: "" }), {});
  const bad = supportDraftErrors({ subject: "Hi", description: "too short", category: "", bookingRef: "" });
  assert.ok(bad.subject && bad.description && bad.category);
  assert.equal(canReply("resolved"), true);
  assert.equal(canReply("closed"), false);
  assert.equal(ticketStatusLabel("in_progress"), "In progress");
  assert.equal(isOwnMessage("partner"), true);
  assert.equal(isOwnMessage("admin"), false);
  assert.equal(isOwnMessage("support"), false);
});

test("a document photo is identified by its bytes, as the server does — not by its claimed type", () => {
  assert.equal(sniffDocumentImage(JPEG), "image/jpeg");
  assert.equal(sniffDocumentImage(PNG), "image/png");
  assert.equal(sniffDocumentImage(WEBP), "image/webp");
  assert.equal(sniffDocumentImage(PDF), null);
  assert.equal(sniffDocumentImage(Buffer.from("RIFFxxxxWAVEfmt ").toString("base64")), null);
});

test("a picked photo becomes a data URL with a matching file name; unreadable, wrong-type and oversize picks are refused", () => {
  const ok = checkDocumentFile({ base64: PNG }, "Bank Cheque");
  assert.deepEqual(ok, { ok: true, file: `data:image/png;base64,${PNG}`, fileName: "bank_cheque.png" });
  assert.equal(checkDocumentFile({ base64: null }, "pan").ok, false);
  assert.equal(checkDocumentFile({ base64: PDF }, "pan").ok, false);
  const big = JPEG + "A".repeat(Math.ceil(((DOCUMENT_MAX_BYTES + 10) * 4) / 3));
  const refused = checkDocumentFile({ base64: big }, "pan");
  assert.equal(refused.ok, false);
  assert.match(refused.ok ? "" : refused.message, /5 MB/);
  assert.equal(base64Bytes("AAAA"), 3);
  assert.equal(base64Bytes("AAA="), 2);
  assert.equal(base64Bytes("AA=="), 1);
});

test("a document's state is the server's: verified locks it, the server's expiry state wins over the date", () => {
  const now = Date.parse("2026-10-07T00:00:00Z");
  assert.deepEqual(documentState({ isVerified: true, expiryDate: null }, now), { label: "Verified", tone: "success", locked: true });
  assert.deepEqual(documentState({ isVerified: false, expiryDate: null }, now), { label: "Not verified yet", tone: "neutral", locked: false });
  assert.equal(documentState({ isVerified: true, expiryDate: "2026-01-01T00:00:00Z" }, now).label, "Expired");
  assert.equal(documentState({ isVerified: true, expiryDate: "2026-10-20T00:00:00Z" }, now, "EXPIRING_SOON").label, "Verified, expires soon");
  // The server says VALID although the device clock would call it expired: the server wins.
  assert.equal(documentState({ isVerified: true, expiryDate: "2026-10-06T23:00:00Z" }, now, "VALID").label, "Verified");
  assert.equal(documentTitle({ documentType: "aadhar", documentName: "scan.jpg" }), "Aadhaar card");
  assert.equal(documentTitle({ documentType: "police_clearance", documentName: null }), "police clearance");
});

test("dates are real calendar dates in YYYY-MM-DD", () => {
  assert.equal(isoDateOrNull("2027-03-31"), "2027-03-31");
  assert.equal(isoDateOrNull("2027-02-30"), null);
  assert.equal(isoDateOrNull("31/03/2027"), null);
  assert.equal(isoDateOrNull(""), null);
});

test("safety: the server's seven report types, and a number is dialled only when it is one", () => {
  assert.deepEqual([...SAFETY_REPORT_TYPES.map((t) => t.value)].sort(), ["ACCIDENT", "CUSTOMER_SAFETY", "LOCATION_DANGER", "MEDICAL", "OTHER", "PARTNER_SAFETY", "THREAT"]);
  assert.equal(safetyTypeLabel("SOS"), "SOS");
  assert.equal(safetyTypeLabel("THREAT"), "I was threatened");
  assert.equal(safetyTypeLabel("NEW_KIND"), "new kind");
  assert.equal(dialable("112"), "112");
  assert.equal(dialable("+91 98765 43210"), "+919876543210");
  assert.equal(dialable(null), null);
  assert.equal(dialable("call ops"), null);
});
