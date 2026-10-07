/**
 * Whether a picked photo can be sent as job evidence — decided on the phone BEFORE the upload, with
 * the server's own rules (apps/backend/src/lib/job-evidence-media.ts): JPEG / PNG / WebP judged from
 * the BYTES, at most 8 MiB decoded, at most 4 per upload. HEIC/HEIF is refused with the server's
 * sentence instead of being sent to collect a 400.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkEvidenceBatch,
  checkEvidencePhoto,
  decodedBase64Bytes,
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_HEIC_MESSAGE,
  EVIDENCE_MAX_PHOTO_BYTES,
  EVIDENCE_MAX_PHOTOS_PER_UPLOAD,
  EVIDENCE_REFUSALS,
  evidenceImageSourceFor,
  evidenceUploadId,
  isApiMediaPath,
  sniffImageMime,
} from "../evidence-photo.ts";

const b64 = (bytes: number[], padTo = 32) => Buffer.from([...bytes, ...new Array(Math.max(0, padTo - bytes.length)).fill(0)]).toString("base64");
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const ftyp = (brand: string) => b64([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, ...Buffer.from(brand, "ascii")]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

test("the limits are the backend's, read from its source", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "lib", "job-evidence-media.ts"), "utf8");
  const num = (name: string) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_* ]+)`));
    assert.ok(m, `${name} not found in the backend`);
    return m[1]!.split("*").map((p) => Number(p.replace(/_/g, "").trim())).reduce((a, b) => a * b, 1);
  };
  assert.equal(EVIDENCE_MAX_PHOTO_BYTES, num("MAX_EVIDENCE_PHOTO_BYTES"));
  assert.equal(EVIDENCE_MAX_PHOTOS_PER_UPLOAD, num("MAX_EVIDENCE_PHOTOS_PER_UPLOAD"));
  assert.equal(EVIDENCE_MAX_PHOTO_BYTES, 8 * 1024 * 1024);
  assert.equal(EVIDENCE_MAX_PHOTOS_PER_UPLOAD, 4);
  assert.deepEqual([...EVIDENCE_ALLOWED_MIME_TYPES], ["image/jpeg", "image/png", "image/webp"]);
  for (const mime of EVIDENCE_ALLOWED_MIME_TYPES) assert.ok(src.includes(mime), mime);
  assert.ok(src.includes(EVIDENCE_HEIC_MESSAGE), "the HEIC sentence is no longer the backend's");
});

test("refusal codes and their HTTP statuses, as the route sends them", () => {
  assert.deepEqual(EVIDENCE_REFUSALS, {
    EVIDENCE_MEDIA_INVALID: 400,
    EVIDENCE_MEDIA_TOO_LARGE: 413,
    EVIDENCE_MEDIA_DUPLICATE: 409,
    EVIDENCE_LIMIT_REACHED: 409,
    BOOKING_NOT_ACTIVE: 409,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
  });
});

test("the type is read from the bytes", () => {
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(WEBP), "image/webp");
  for (const brand of ["heic", "heix", "hevc", "mif1", "msf1", "heif"]) assert.equal(sniffImageMime(ftyp(brand)), "image/heic", brand);
  assert.equal(sniffImageMime(ftyp("avif")), "image/avif");
  assert.equal(sniffImageMime(GIF), null);
  assert.equal(sniffImageMime(""), null);
  assert.equal(sniffImageMime("!!!not base64!!!"), null);
});

test("a JPEG, PNG or WebP is sendable, as a data URL labelled with what the bytes ARE", () => {
  const r = checkEvidencePhoto({ base64: JPEG, mimeType: "image/jpeg" });
  assert.deepEqual(r, { ok: true, mimeType: "image/jpeg", bytes: 32, dataUrl: `data:image/jpeg;base64,${JPEG}` });
  assert.equal(checkEvidencePhoto({ base64: PNG }).ok, true);
  assert.equal(checkEvidencePhoto({ base64: WEBP, mimeType: null }).ok, true);
});

test("Android re-encodes to JPEG but reports the SOURCE type: the label follows the bytes, not the report", () => {
  const r = checkEvidencePhoto({ base64: JPEG, mimeType: "image/heic" });
  assert.equal(r.ok && r.dataUrl, `data:image/jpeg;base64,${JPEG}`);
  const png = checkEvidencePhoto({ base64: JPEG, mimeType: "image/png" });
  assert.equal(png.ok && png.mimeType, "image/jpeg");
});

test("HEIC / HEIF bytes are refused with the server's sentence — whatever the picker called them", () => {
  for (const mimeType of ["image/heic", "image/jpeg", undefined]) {
    assert.deepEqual(checkEvidencePhoto({ base64: ftyp("heic"), mimeType }), {
      ok: false,
      reason: "HEIC",
      code: "EVIDENCE_MEDIA_INVALID",
      status: 400,
      message: "This photo format (HEIC) is not supported. Send JPEG or PNG.",
    });
  }
});

test("anything else that is not JPEG/PNG/WebP is refused as unsupported", () => {
  const r = checkEvidencePhoto({ base64: GIF });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "UNSUPPORTED_TYPE");
  assert.equal(!r.ok && r.code, "EVIDENCE_MEDIA_INVALID");
  assert.equal(!r.ok && r.status, 400);
});

test("AVIF is in the server's HEIF family: same refusal, same sentence", () => {
  const r = checkEvidencePhoto({ base64: ftyp("avif") });
  assert.equal(!r.ok && r.reason, "HEIC");
  assert.equal(!r.ok && r.message, EVIDENCE_HEIC_MESSAGE);
});

test("the HEIF brands are exactly the backend's", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "lib", "job-evidence-media.ts"), "utf8");
  const m = src.match(/HEIF_BRANDS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "HEIF_BRANDS not found in the backend");
  const theirs = [...m[1]!.matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]!);
  assert.ok(theirs.length >= 10);
  for (const brand of theirs) {
    const r = checkEvidencePhoto({ base64: ftyp(brand) });
    assert.equal(!r.ok && r.reason, "HEIC", brand);
  }
});

test("no bytes (the picker was not asked for base64, or it failed) is refused, not sent as a link", () => {
  for (const base64 of [null, undefined, ""]) {
    const r = checkEvidencePhoto({ base64, uri: "file:///x.jpg" });
    assert.equal(!r.ok && r.reason, "NO_DATA");
  }
});

test("size is the DECODED size: exactly 8 MiB passes, one byte more is refused with 413", () => {
  // A JPEG header ("/9j/" = 3 bytes) followed by zero bytes, padded to an exact decoded length.
  const sized = (bytes: number) => {
    const full = Math.floor(bytes / 3);
    const rem = bytes % 3;
    return "/9j/" + "A".repeat((full - 1) * 4) + (rem === 1 ? "AA==" : rem === 2 ? "AAA=" : "");
  };
  assert.equal(decodedBase64Bytes(sized(EVIDENCE_MAX_PHOTO_BYTES)), EVIDENCE_MAX_PHOTO_BYTES);
  assert.equal(checkEvidencePhoto({ base64: sized(EVIDENCE_MAX_PHOTO_BYTES) }).ok, true);
  const over = checkEvidencePhoto({ base64: sized(EVIDENCE_MAX_PHOTO_BYTES + 1) });
  assert.deepEqual(over, { ok: false, reason: "TOO_LARGE", code: "EVIDENCE_MEDIA_TOO_LARGE", status: 413, message: "That photo is too large. Send one under 8 MB." });
});

test("decoded size ignores padding and whitespace", () => {
  assert.equal(decodedBase64Bytes("AAAA"), 3);
  assert.equal(decodedBase64Bytes("AAA="), 2);
  assert.equal(decodedBase64Bytes("AA=="), 1);
  assert.equal(decodedBase64Bytes("AAAA\nAAAA"), 6);
  assert.equal(decodedBase64Bytes(""), 0);
});

test("at most 4 photos per upload; the first refused photo refuses the batch", () => {
  const four = [JPEG, PNG, WEBP, JPEG].map((base64) => ({ base64 }));
  const ok = checkEvidenceBatch(four);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.dataUrls.length, 4);
  const five = checkEvidenceBatch([...four, { base64: JPEG }]);
  assert.deepEqual(five, { ok: false, reason: "TOO_MANY", code: "EVIDENCE_MEDIA_INVALID", status: 400, message: "At most 4 photos can be sent at once" });
  const mixed = checkEvidenceBatch([{ base64: JPEG }, { base64: ftyp("heic") }]);
  assert.equal(!mixed.ok && mixed.reason, "HEIC");
  assert.equal(!mixed.ok && mixed.index, 1);
  const none = checkEvidenceBatch([]);
  assert.equal(!none.ok && none.reason, "NO_DATA");
});

test("upload ids: one per picked photo, stable across a retry of the same pick", () => {
  assert.equal(evidenceUploadId("ARRIVAL", 1_760_000_000_000), "m-arrival-1760000000000");
  assert.equal(evidenceUploadId("COMPLETION", 1_760_000_000_000, "step-rinse"), "m-completion-step-rinse-1760000000000");
  assert.notEqual(evidenceUploadId("START", 1), evidenceUploadId("START", 2));
});

test("an evidence URL on the API needs the bearer token; anything else does not", () => {
  assert.equal(isApiMediaPath("/api/bookings/b1/evidence/e1/media"), true);
  assert.equal(isApiMediaPath("https://cdn.example/x.jpg"), false);
  assert.equal(isApiMediaPath(null), false);
});

test("the Image source: an API path gets the base and the bearer header; the token goes nowhere else", () => {
  const path = "/api/bookings/b1/evidence/e1/media";
  assert.deepEqual(evidenceImageSourceFor(path, "https://api.example/", "tok"), {
    uri: "https://api.example/api/bookings/b1/evidence/e1/media",
    headers: { Authorization: "Bearer tok" },
  });
  assert.deepEqual(evidenceImageSourceFor("https://signed.example/x.jpg?sig=1", "https://api.example", "tok"), { uri: "https://signed.example/x.jpg?sig=1" });
  assert.equal(evidenceImageSourceFor(path, "https://api.example", null), null);
  assert.equal(evidenceImageSourceFor(null, "https://api.example", "tok"), null);
  assert.equal(evidenceImageSourceFor("", "https://api.example", "tok"), null);
});
