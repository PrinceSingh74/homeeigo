import { createHash } from "node:crypto";
import type { ImageExt } from "./rating-photos";

/**
 * What counts as a photo of a job, and where it lives.
 *
 * A link proves nothing: the upload route used to store whatever URL or storage key the client sent
 * and the quality gate counted the row as proof. Evidence media is now the image itself, received
 * from the partner holding the job and stored by the server under a key only the server writes:
 *
 *   ev1/<bookingId>/<providerId>/<STAGE>/<uuid>.<ext>
 *
 * The key says which booking, which partner and which stage the bytes were received for, so a row
 * cannot borrow another booking's, partner's or stage's photo. A row whose key is not of this shape
 * (a legacy URL, a key typed by a client) is metadata, not proof.
 *
 * Adversarial audit, 2026-10-07:
 *   - three magic bytes were accepted as an image. A photo now needs the structure of one: the
 *     header that states its dimensions and the part that carries the picture;
 *   - nothing tied a row to its bytes, so one photo served as both "before" and "after". Every
 *     accepted image carries the SHA-256 of its bytes, which the service stores and compares;
 *   - the upload route and `/complete` each had their own sentences, and `/complete` told a partner
 *     with an oversized photo that a link is not accepted. One table (`evidenceRefusal`) now answers
 *     both.
 */
export const EVIDENCE_NAMESPACE = "job-evidence" as const;
export const EVIDENCE_STAGES = ["ARRIVAL", "START", "COMPLETION"] as const;
export type EvidenceStage = (typeof EVIDENCE_STAGES)[number];
/** Largest decoded image accepted for one evidence photo. */
export const MAX_EVIDENCE_PHOTO_BYTES = 8 * 1024 * 1024;
/** Photos accepted in one upload (a before/after pair fits; a gallery does not). */
export const MAX_EVIDENCE_PHOTOS_PER_UPLOAD = 4;
/** Largest width or height believed. A phone camera is ~8000 px on its long side; panoramas reach ~16000. */
export const MAX_EVIDENCE_DIMENSION_PX = 20_000;
/**
 * Current photos one partner may hold for one stage of one job (three full uploads). A before/after
 * pair is two; a careful partner photographing several rooms is still under this.
 */
export const MAX_EVIDENCE_PHOTOS_PER_STAGE = 12;
/**
 * Evidence rows one partner may write on one job, replaced ones included — so "replace" in a loop is
 * bounded too. Three stages of twelve, plus the system's own arrival / start / completion stamps.
 */
export const MAX_EVIDENCE_ROWS_PER_BOOKING = 40;
/** How far back the same partner's other jobs are searched for the same photo. */
export const EVIDENCE_REUSE_LOOKBACK_DAYS = 90;

const MIME: Record<ImageExt, string> = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const SEGMENT = "[A-Za-z0-9_-]+";
const KEY = new RegExp(`^ev1/(${SEGMENT})/(${SEGMENT})/(ARRIVAL|START|COMPLETION)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png|webp)$`);

export type EvidenceImage = { bytes: Buffer; ext: ImageExt; mimeType: string; sha256: string; width: number; height: number };
export type EvidenceImageError = "NOT_AN_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_IMAGE_FORMAT";

/* ------------------------------------------------------------------------------------------------
 * Image structure — read from the bytes, without decoding (no native image dependency).
 *
 * This is not a decoder: a file can pass and still be a corrupt picture. What it rules out is the
 * cheap forgery — a signature with nothing behind it — and it gives the dimensions the file claims.
 * ---------------------------------------------------------------------------------------------- */

type Dimensions = { width: number; height: number };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** PNG: signature, IHDR (13 bytes) first, at least one non-empty IDAT, and IEND — walked chunk by chunk. */
function pngDimensions(b: Buffer): Dimensions | null {
  // signature 8 + IHDR 25 + smallest IDAT 13 + IEND 12
  if (b.length < 58 || !b.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (b.readUInt32BE(8) !== 13 || b.toString("latin1", 12, 16) !== "IHDR") return null;
  const dims = { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  let offset = 33;
  let hasImageData = false;
  while (offset + 12 <= b.length) {
    const length = b.readUInt32BE(offset);
    const type = b.toString("latin1", offset + 4, offset + 8);
    if (type === "IEND") return hasImageData ? dims : null;
    if (offset + 12 + length > b.length) return null;
    if (type === "IDAT" && length > 0) hasImageData = true;
    offset += 12 + length;
  }
  return null;
}

/** JPEG: SOI, then segments up to a frame header (SOFn, which holds the dimensions) and a scan with data after it. */
function jpegDimensions(b: Buffer): Dimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  let dims: Dimensions | null = null;
  while (offset + 4 <= b.length) {
    if (b[offset] !== 0xff) return null;
    const marker = b[offset + 1]!;
    if (marker === 0xff) { offset += 1; continue; } // fill byte
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; } // no payload
    if (marker === 0xd9) return null; // end of image before any scan
    const length = b.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > b.length) return null;
    if (marker === 0xda) return dims && b.length > offset + 2 + length ? dims : null; // scan: needs a frame header before it and data after it
    const isFrameHeader = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrameHeader) {
      if (length < 8) return null;
      dims = { height: b.readUInt16BE(offset + 5), width: b.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

/** WebP: RIFF/WEBP whose first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended), each with its own header. */
function webpDimensions(b: Buffer): Dimensions | null {
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  const riffSize = b.readUInt32LE(4);
  // The RIFF size covers everything after it; a file shorter than it claims is truncated.
  if (riffSize < 22 || riffSize + 8 > b.length + 1) return null;
  const chunk = b.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: b.readUIntLE(24, 3) + 1, height: b.readUIntLE(27, 3) + 1 };
  return null;
}

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1", "heif", "avif", "avis"]);

/** An ISO-BMFF still image (iPhone HEIC/HEIF, AVIF): recognised so the refusal can say what to send instead. */
export function isHeifFamily(b: Buffer): boolean {
  return b.length >= 12 && b.toString("latin1", 4, 8) === "ftyp" && HEIF_BRANDS.has(b.toString("latin1", 8, 12).toLowerCase());
}

/**
 * The type and dimensions of an image, from its own structure. Null for anything that is not a PNG,
 * JPEG or WebP with a readable header and a body, or whose dimensions are 0 or beyond belief.
 */
export function inspectEvidenceImage(bytes: Buffer): ({ ext: ImageExt } & Dimensions) | null {
  let found: ({ ext: ImageExt } & Dimensions) | null = null;
  try {
    const png = pngDimensions(bytes);
    const jpg = png ? null : jpegDimensions(bytes);
    const webp = png || jpg ? null : webpDimensions(bytes);
    if (png) found = { ext: ".png", ...png };
    else if (jpg) found = { ext: ".jpg", ...jpg };
    else if (webp) found = { ext: ".webp", ...webp };
  } catch {
    return null; // a read past the end of a malformed file
  }
  if (!found) return null;
  const sane = (n: number) => Number.isInteger(n) && n > 0 && n <= MAX_EVIDENCE_DIMENSION_PX;
  return sane(found.width) && sane(found.height) ? found : null;
}

/**
 * The image carried by a `data:` URL, judged by its own bytes (never the declared type).
 * Anything else — an http(s) link, a storage key, text — is not an image.
 *
 * HEIC / HEIF / AVIF is refused on purpose, as its own outcome: evidence is viewed in a browser (the
 * partner web panel, the admin console, a signed link) and Chrome and Firefox do not render HEIC;
 * converting it would need a native image library. The partner is told to send JPEG or PNG.
 */
export function imageFromDataUrl(value: unknown): { ok: true; image: EvidenceImage } | { ok: false; error: EvidenceImageError } {
  if (typeof value !== "string") return { ok: false, error: "NOT_AN_IMAGE" };
  const m = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i.exec(value);
  if (!m) return { ok: false, error: "NOT_AN_IMAGE" };
  // Base64 length bounds the decoded size; refuse before allocating a large buffer.
  if (m[1].length > Math.ceil((MAX_EVIDENCE_PHOTO_BYTES * 4) / 3) + 8) return { ok: false, error: "IMAGE_TOO_LARGE" };
  const bytes = Buffer.from(m[1], "base64");
  if (bytes.length === 0) return { ok: false, error: "NOT_AN_IMAGE" };
  if (bytes.length > MAX_EVIDENCE_PHOTO_BYTES) return { ok: false, error: "IMAGE_TOO_LARGE" };
  const info = inspectEvidenceImage(bytes);
  if (!info) return { ok: false, error: isHeifFamily(bytes) ? "UNSUPPORTED_IMAGE_FORMAT" : "NOT_AN_IMAGE" };
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { ok: true, image: { bytes, ext: info.ext, mimeType: MIME[info.ext], sha256, width: info.width, height: info.height } };
}

/* ------------------------------------------------------------------------------------------------
 * Refusals — one table for the upload route and for `/complete`.
 * ---------------------------------------------------------------------------------------------- */

export type EvidenceRefusalCode = "EVIDENCE_MEDIA_INVALID" | "EVIDENCE_MEDIA_TOO_LARGE" | "EVIDENCE_MEDIA_DUPLICATE" | "EVIDENCE_LIMIT_REACHED";
export type EvidenceRefusalReason =
  | "NOT_AN_IMAGE"
  | "STORAGE_KEY"
  | "UNSUPPORTED_FORMAT"
  | "TOO_MANY_PHOTOS"
  | "TOO_LARGE"
  | "DUPLICATE_OTHER_STAGE"
  | "DUPLICATE_OTHER_BOOKING"
  | "STAGE_LIMIT"
  | "BOOKING_LIMIT";
/** `stage` is the stage the same photo was already sent for (DUPLICATE_OTHER_STAGE only). */
export type EvidenceRefusal = { reason: EvidenceRefusalReason; stage?: EvidenceStage };

const STAGE_WORDS: Record<EvidenceStage, string> = { ARRIVAL: "your arrival", START: "the start of the job", COMPLETION: "the completed job" };

const REFUSALS: Record<EvidenceRefusalReason, { status: number; code: EvidenceRefusalCode; message: (r: EvidenceRefusal) => string }> = {
  NOT_AN_IMAGE: { status: 400, code: "EVIDENCE_MEDIA_INVALID", message: () => "Send the photo itself (JPEG, PNG or WebP). A link is not accepted as evidence." },
  STORAGE_KEY: { status: 400, code: "EVIDENCE_MEDIA_INVALID", message: () => "Send the photo itself. A storage key is not accepted." },
  UNSUPPORTED_FORMAT: { status: 400, code: "EVIDENCE_MEDIA_INVALID", message: () => "This photo format (HEIC) is not supported. Send JPEG or PNG." },
  TOO_MANY_PHOTOS: { status: 400, code: "EVIDENCE_MEDIA_INVALID", message: () => `At most ${MAX_EVIDENCE_PHOTOS_PER_UPLOAD} photos can be sent at once` },
  TOO_LARGE: { status: 413, code: "EVIDENCE_MEDIA_TOO_LARGE", message: () => `That photo is too large. Send one under ${MAX_EVIDENCE_PHOTO_BYTES / (1024 * 1024)} MB.` },
  DUPLICATE_OTHER_STAGE: {
    status: 409,
    code: "EVIDENCE_MEDIA_DUPLICATE",
    message: (r) => `This is the same photo you already sent for ${r.stage ? STAGE_WORDS[r.stage] : "another step of this job"}. Take a new one.`,
  },
  DUPLICATE_OTHER_BOOKING: { status: 409, code: "EVIDENCE_MEDIA_DUPLICATE", message: () => "This is the same photo you already sent for another job. Take a new one." },
  STAGE_LIMIT: { status: 409, code: "EVIDENCE_LIMIT_REACHED", message: () => `This step already has ${MAX_EVIDENCE_PHOTOS_PER_STAGE} photos. Replace them instead of adding more.` },
  BOOKING_LIMIT: { status: 409, code: "EVIDENCE_LIMIT_REACHED", message: () => "No more evidence can be added to this job." },
};

/** When only a code is known (an older throw site), the reason it stands for. */
const DEFAULT_REASON: Record<EvidenceRefusalCode, EvidenceRefusalReason> = {
  EVIDENCE_MEDIA_INVALID: "NOT_AN_IMAGE",
  EVIDENCE_MEDIA_TOO_LARGE: "TOO_LARGE",
  EVIDENCE_MEDIA_DUPLICATE: "DUPLICATE_OTHER_STAGE",
  EVIDENCE_LIMIT_REACHED: "BOOKING_LIMIT",
};

export type EvidenceRefusalResponse = { status: number; code: EvidenceRefusalCode; error: string; reason: EvidenceRefusalReason };

/** The HTTP status, code and sentence for a refusal. The only place these sentences are written. */
export function evidenceRefusal(refusal: EvidenceRefusal): EvidenceRefusalResponse {
  const entry = REFUSALS[refusal.reason];
  return { status: entry.status, code: entry.code, error: entry.message(refusal), reason: refusal.reason };
}

/** Thrown by the service; `message` is the code, so callers that switch on `err.message` keep working. */
export class EvidenceRefusedError extends Error {
  readonly refusal: EvidenceRefusal;
  constructor(refusal: EvidenceRefusal) {
    super(REFUSALS[refusal.reason].code);
    this.name = "EvidenceRefusedError";
    this.refusal = refusal;
  }
}

/** The refusal an error stands for, or null when the error is about something else. */
export function evidenceRefusalFromError(err: unknown): EvidenceRefusalResponse | null {
  if (err instanceof EvidenceRefusedError) return evidenceRefusal(err.refusal);
  const code = err instanceof Error ? err.message : null;
  if (code && Object.prototype.hasOwnProperty.call(DEFAULT_REASON, code)) return evidenceRefusal({ reason: DEFAULT_REASON[code as EvidenceRefusalCode] });
  return null;
}

/** The photos of one upload, judged together: one bad photo refuses the upload, nothing is half-accepted. */
export function parseEvidencePhotos(values: readonly unknown[]): { ok: true; images: EvidenceImage[] } | { ok: false; refusal: EvidenceRefusal } {
  if (values.length > MAX_EVIDENCE_PHOTOS_PER_UPLOAD) return { ok: false, refusal: { reason: "TOO_MANY_PHOTOS" } };
  const images: EvidenceImage[] = [];
  for (const value of values) {
    const parsed = imageFromDataUrl(value);
    if (!parsed.ok) {
      const reason = parsed.error === "IMAGE_TOO_LARGE" ? "TOO_LARGE" : parsed.error === "UNSUPPORTED_IMAGE_FORMAT" ? "UNSUPPORTED_FORMAT" : "NOT_AN_IMAGE";
      return { ok: false, refusal: { reason } };
    }
    images.push(parsed.image);
  }
  return { ok: true, images };
}

export function serverEvidenceKey(input: { bookingId: string; providerId: string; stage: EvidenceStage; id: string; ext: ImageExt }): string {
  return `ev1/${input.bookingId}/${input.providerId}/${input.stage}/${input.id}${input.ext}`;
}

/** The booking, partner and stage a server-written evidence key was stored for, or null for any other string. */
export function parseServerEvidenceKey(key: string | null | undefined): { bookingId: string; providerId: string; stage: EvidenceStage } | null {
  const m = typeof key === "string" ? KEY.exec(key) : null;
  return m ? { bookingId: m[1], providerId: m[2], stage: m[3] as EvidenceStage } : null;
}

/**
 * Is this row's media a photo the server received for this booking, this partner and this stage?
 * `owner` is the row's own booking, partner and stage: a key copied from elsewhere does not match.
 */
export function isServerStoredEvidence(row: { mediaStorageKey?: string | null; bookingId?: string | null; providerId?: string | null; stage?: string | null }): boolean {
  const parsed = parseServerEvidenceKey(row.mediaStorageKey);
  if (!parsed) return false;
  if (row.bookingId != null && row.bookingId !== parsed.bookingId) return false;
  if (row.providerId != null && row.providerId !== parsed.providerId) return false;
  if (row.stage != null && row.stage !== parsed.stage) return false;
  return true;
}

/** The SHA-256 the server recorded for a row's photo (`metadata.sha256`), or null for a row without one. */
export function evidenceSha256(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).sha256;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
