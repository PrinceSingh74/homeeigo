/**
 * Evidence media is the image itself, stored by the server (pure rules).
 * Re-audit, 2026-10-06: any URL or storage-key string counted as photo proof.
 */
import { describe, expect, test } from "bun:test";
import {
  EvidenceRefusedError,
  evidenceRefusal,
  evidenceRefusalFromError,
  imageFromDataUrl,
  isServerStoredEvidence,
  MAX_EVIDENCE_DIMENSION_PX,
  MAX_EVIDENCE_PHOTO_BYTES,
  MAX_EVIDENCE_PHOTOS_PER_UPLOAD,
  parseEvidencePhotos,
  parseServerEvidenceKey,
  serverEvidenceKey,
} from "../lib/job-evidence-media";
import { hasAuthoritativeMedia } from "../lib/quality-evidence";
import { caseProofCandidate } from "../lib/booking-case-policy";
import { dataUrl, heifBytes, jpegBytes, PNG_DATA_URL, pngBytes, pngDataUrl, webpBytes } from "./helpers/evidence-photo";

describe("only an image is an image", () => {
  test("a data URL whose bytes are a PNG, JPEG or WebP is accepted, by its bytes", () => {
    const r = imageFromDataUrl(PNG_DATA_URL);
    expect(r.ok).toBe(true);
    if (r.ok) expect({ ext: r.image.ext, mime: r.image.mimeType }).toEqual({ ext: ".png", mime: "image/png" });
    // Declared as JPEG, actually a PNG: the bytes decide.
    const relabelled = imageFromDataUrl(PNG_DATA_URL.replace("image/png", "image/jpeg"));
    expect(relabelled.ok && relabelled.image.ext).toBe(".png");
  });

  test("a link, a storage key, text dressed as an image, or nothing is refused", () => {
    for (const bad of ["https://example.test/photo.jpg", "s3/evidence/b1/start.jpg", "data:text/plain;base64,aGVsbG8=", `data:image/png;base64,${Buffer.from("not an image").toString("base64")}`, "", null, 42]) {
      expect({ bad, r: imageFromDataUrl(bad) }).toEqual({ bad, r: { ok: false, error: "NOT_AN_IMAGE" } });
    }
  });

  test("an image over the size limit is refused before it is stored", () => {
    const huge = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_EVIDENCE_PHOTO_BYTES * 4) / 3) + 64)}`;
    expect(imageFromDataUrl(huge)).toEqual({ ok: false, error: "IMAGE_TOO_LARGE" });
  });
});

/** Adversarial audit, 2026-10-07: three magic bytes were "an image"; nothing tied a photo to its bytes. */
describe("an image has a body, not only a signature", () => {
  const refused = (bytes: Buffer, mime = "image/png") => imageFromDataUrl(dataUrl(bytes, mime));

  test("the signature alone is refused for every format", () => {
    expect(refused(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(Buffer.from("RIFF\x04\x00\x00\x00WEBP", "latin1"), "image/webp")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    // A signature followed by filler is still not an image.
    expect(refused(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(4096, 0x41)]), "image/jpeg")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 0x41)]))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
  });

  test("a PNG, JPEG and WebP with a readable header are accepted with their dimensions", () => {
    const png = imageFromDataUrl(dataUrl(pngBytes("a", { width: 6, height: 3 })));
    expect(png.ok && { ext: png.image.ext, w: png.image.width, h: png.image.height }).toEqual({ ext: ".png", w: 6, h: 3 });
    const jpg = imageFromDataUrl(dataUrl(jpegBytes(640, 480), "image/jpeg"));
    expect(jpg.ok && { ext: jpg.image.ext, w: jpg.image.width, h: jpg.image.height }).toEqual({ ext: ".jpg", w: 640, h: 480 });
    for (const kind of ["VP8 ", "VP8L", "VP8X"] as const) {
      const webp = imageFromDataUrl(dataUrl(webpBytes(kind, 320, 240), "image/webp"));
      expect({ kind, r: webp.ok && { ext: webp.image.ext, w: webp.image.width, h: webp.image.height } }).toEqual({ kind, r: { ext: ".webp", w: 320, h: 240 } });
    }
  });

  test("zero and absurd dimensions are refused", () => {
    expect(refused(pngBytes("z", { declared: { width: 0, height: 4 } }))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(pngBytes("z", { declared: { width: 4, height: 0 } }))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(pngBytes("z", { declared: { width: MAX_EVIDENCE_DIMENSION_PX + 1, height: 4 } }))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(jpegBytes(0, 480), "image/jpeg")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(refused(jpegBytes(640, MAX_EVIDENCE_DIMENSION_PX + 1), "image/jpeg")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    expect(imageFromDataUrl(dataUrl(pngBytes("z", { declared: { width: MAX_EVIDENCE_DIMENSION_PX, height: 4 } }))).ok).toBe(true);
  });

  test("a PNG cut off before its image data, or a JPEG with no scan, is refused", () => {
    const png = pngBytes("cut");
    expect(refused(png.subarray(0, 33))).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
    const jpg = jpegBytes();
    expect(refused(jpg.subarray(0, jpg.indexOf(Buffer.from([0xff, 0xda]))), "image/jpeg")).toEqual({ ok: false, error: "NOT_AN_IMAGE" });
  });

  test("an iPhone HEIC photo is refused as an unsupported format, and the partner is told what to send", () => {
    for (const brand of ["heic", "heix", "mif1", "heif"]) {
      expect({ brand, r: imageFromDataUrl(dataUrl(heifBytes(brand), "image/heic")) }).toEqual({ brand, r: { ok: false, error: "UNSUPPORTED_IMAGE_FORMAT" } });
    }
    const parsed = parseEvidencePhotos([dataUrl(heifBytes(), "image/heic")]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      const r = evidenceRefusal(parsed.refusal);
      expect({ status: r.status, code: r.code }).toEqual({ status: 400, code: "EVIDENCE_MEDIA_INVALID" });
      expect(r.error).toContain("JPEG or PNG");
    }
  });

  test("every accepted image carries the SHA-256 of its bytes: same bytes same hash, another photo another hash", () => {
    const a = imageFromDataUrl(pngDataUrl("one"));
    const again = imageFromDataUrl(pngDataUrl("one"));
    const b = imageFromDataUrl(pngDataUrl("two"));
    expect(a.ok && again.ok && b.ok).toBe(true);
    if (a.ok && again.ok && b.ok) {
      expect(a.image.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(again.image.sha256).toBe(a.image.sha256);
      expect(b.image.sha256).not.toBe(a.image.sha256);
    }
  });
});

describe("one table says why an upload was refused, for the upload route and for completion", () => {
  test("each refusal has its own status, code and sentence", () => {
    const seen = {
      link: evidenceRefusal({ reason: "NOT_AN_IMAGE" }),
      key: evidenceRefusal({ reason: "STORAGE_KEY" }),
      many: evidenceRefusal({ reason: "TOO_MANY_PHOTOS" }),
      large: evidenceRefusal({ reason: "TOO_LARGE" }),
      otherStage: evidenceRefusal({ reason: "DUPLICATE_OTHER_STAGE", stage: "START" }),
      otherJob: evidenceRefusal({ reason: "DUPLICATE_OTHER_BOOKING" }),
      stageFull: evidenceRefusal({ reason: "STAGE_LIMIT" }),
      jobFull: evidenceRefusal({ reason: "BOOKING_LIMIT" }),
    };
    expect(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [v.status, v.code]]))).toEqual({
      link: [400, "EVIDENCE_MEDIA_INVALID"],
      key: [400, "EVIDENCE_MEDIA_INVALID"],
      many: [400, "EVIDENCE_MEDIA_INVALID"],
      large: [413, "EVIDENCE_MEDIA_TOO_LARGE"],
      otherStage: [409, "EVIDENCE_MEDIA_DUPLICATE"],
      otherJob: [409, "EVIDENCE_MEDIA_DUPLICATE"],
      stageFull: [409, "EVIDENCE_LIMIT_REACHED"],
      jobFull: [409, "EVIDENCE_LIMIT_REACHED"],
    });
    expect(seen.large.error).toContain("too large");
    expect(seen.large.error).not.toContain("link");
    expect(seen.otherStage.error).toBe("This is the same photo you already sent for the start of the job. Take a new one.");
    expect(new Set(Object.values(seen).map((v) => v.error)).size).toBe(8);
  });

  test("an error thrown by the service is read back as the same refusal; anything else is not one", () => {
    const thrown = new EvidenceRefusedError({ reason: "DUPLICATE_OTHER_STAGE", stage: "ARRIVAL" });
    expect(thrown.message).toBe("EVIDENCE_MEDIA_DUPLICATE");
    expect(evidenceRefusalFromError(thrown)).toEqual(evidenceRefusal({ reason: "DUPLICATE_OTHER_STAGE", stage: "ARRIVAL" }));
    // A bare code (older throw sites) still maps to its own sentence.
    expect(evidenceRefusalFromError(new Error("EVIDENCE_MEDIA_TOO_LARGE"))).toEqual(evidenceRefusal({ reason: "TOO_LARGE" }));
    expect(evidenceRefusalFromError(new Error("QUALITY_PROOF_REQUIRED"))).toBeNull();
    expect(evidenceRefusalFromError("nope")).toBeNull();
  });

  test("photos are judged together: a link, an oversized photo and too many each refuse the whole upload", () => {
    expect(parseEvidencePhotos([pngDataUrl("p1"), "https://example.test/a.jpg"])).toEqual({ ok: false, refusal: { reason: "NOT_AN_IMAGE" } });
    const huge = `data:image/png;base64,${"A".repeat(Math.ceil((MAX_EVIDENCE_PHOTO_BYTES * 4) / 3) + 64)}`;
    expect(parseEvidencePhotos([huge])).toEqual({ ok: false, refusal: { reason: "TOO_LARGE" } });
    expect(parseEvidencePhotos(Array.from({ length: MAX_EVIDENCE_PHOTOS_PER_UPLOAD + 1 }, (_, i) => pngDataUrl(`n${i}`)))).toEqual({ ok: false, refusal: { reason: "TOO_MANY_PHOTOS" } });
    const ok = parseEvidencePhotos([pngDataUrl("p1"), pngDataUrl("p2")]);
    expect(ok.ok && ok.images.length).toBe(2);
  });
});

describe("what a case counts as proof", () => {
  const caseId = "5d2c1a52-6a8e-4d0e-9d43-0c1f6f1f0a11";
  const jobKey = serverEvidenceKey({ bookingId: "bk1", providerId: "pr1", stage: "COMPLETION", id: "0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d", ext: ".jpg" });

  test("a note, a URL, a key the server did not write and job evidence without a stored photo are not proof", () => {
    expect(caseProofCandidate({ kind: "NOTE", caseId, bookingId: "bk1" })).toBe(false);
    expect(caseProofCandidate({ kind: "CUSTOMER_MEDIA", caseId, bookingId: "bk1", mediaUrl: "https://cdn.example.test/after.jpg" })).toBe(false);
    expect(caseProofCandidate({ kind: "CUSTOMER_MEDIA", caseId, bookingId: "bk1", mediaStorageKey: "k/1" })).toBe(false);
    expect(caseProofCandidate({ kind: "CUSTOMER_MEDIA", caseId, bookingId: "bk1", mediaStorageKey: `another-case/0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d.jpg` })).toBe(false);
    // Job evidence: a geotag-only row, a legacy URL row, another booking's photo.
    expect(caseProofCandidate({ kind: "JOB_EVIDENCE", caseId, bookingId: "bk1", jobEvidence: { bookingId: "bk1", providerId: "pr1", stage: "COMPLETION", mediaStorageKey: null } })).toBe(false);
    expect(caseProofCandidate({ kind: "JOB_EVIDENCE", caseId, bookingId: "bk1", jobEvidence: null })).toBe(false);
    expect(caseProofCandidate({ kind: "JOB_EVIDENCE", caseId, bookingId: "bk2", jobEvidence: { bookingId: "bk2", providerId: "pr1", stage: "COMPLETION", mediaStorageKey: jobKey } })).toBe(false);
  });

  test("a photo the server stored for this case, or this booking's server-stored job photo, is", () => {
    expect(caseProofCandidate({ kind: "CUSTOMER_MEDIA", caseId, bookingId: "bk1", mediaStorageKey: `${caseId}/0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d.jpg` })).toBe(true);
    expect(caseProofCandidate({ kind: "JOB_EVIDENCE", caseId, bookingId: "bk1", jobEvidence: { bookingId: "bk1", providerId: "pr1", stage: "COMPLETION", mediaStorageKey: jobKey } })).toBe(true);
  });
});

describe("the storage key says whose photo it is", () => {
  const key = serverEvidenceKey({ bookingId: "bk1", providerId: "pr1", stage: "COMPLETION", id: "0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d", ext: ".jpg" });

  test("a server-written key is recognised and names its booking, partner and stage", () => {
    expect(parseServerEvidenceKey(key)).toEqual({ bookingId: "bk1", providerId: "pr1", stage: "COMPLETION" });
    expect(isServerStoredEvidence({ mediaStorageKey: key, bookingId: "bk1", providerId: "pr1", stage: "COMPLETION" })).toBe(true);
  });

  test("the same key on another booking's, partner's or stage's row is not that row's proof", () => {
    expect(isServerStoredEvidence({ mediaStorageKey: key, bookingId: "bk2", providerId: "pr1", stage: "COMPLETION" })).toBe(false);
    expect(isServerStoredEvidence({ mediaStorageKey: key, bookingId: "bk1", providerId: "pr2", stage: "COMPLETION" })).toBe(false);
    expect(isServerStoredEvidence({ mediaStorageKey: key, bookingId: "bk1", providerId: "pr1", stage: "START" })).toBe(false);
  });

  test("a client-shaped key, a traversal, or a legacy path is not a server key", () => {
    for (const bad of ["s3/evidence/bk1/completion.jpg", "ev1/bk1/pr1/COMPLETION/../../x.jpg", "ev1/bk1/pr1/COMPLETION/name.jpg", "ev1/bk1/pr1/OTHER/0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d.jpg", "", null]) {
      expect({ bad, parsed: parseServerEvidenceKey(bad) }).toEqual({ bad, parsed: null });
    }
  });
});

describe("what the quality gate counts as a photo", () => {
  const key = serverEvidenceKey({ bookingId: "bk1", providerId: "pr1", stage: "START", id: "0b9f3c2e-7a41-4c1d-9e55-1d2f3a4b5c6d", ext: ".png" });

  test("a server-stored photo counts", () => {
    expect(hasAuthoritativeMedia({ stage: "START", mediaUrl: null, mediaStorageKey: key, bookingId: "bk1", providerId: "pr1" })).toBe(true);
  });

  test("a URL alone never counts, whatever it points at", () => {
    expect(hasAuthoritativeMedia({ stage: "START", mediaUrl: "https://example.test/photo.jpg", mediaStorageKey: null })).toBe(false);
    expect(hasAuthoritativeMedia({ stage: "START", mediaUrl: PNG_DATA_URL, mediaStorageKey: null })).toBe(false);
  });

  test("a key the server did not write never counts", () => {
    expect(hasAuthoritativeMedia({ stage: "START", mediaUrl: null, mediaStorageKey: "s3/evidence/bk1/start.jpg" })).toBe(false);
  });
});
