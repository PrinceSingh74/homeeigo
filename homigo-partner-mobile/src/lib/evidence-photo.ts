/**
 * Whether a picked photo can be sent as job evidence, decided on the phone before the upload.
 * Pure: no React Native import (the screen passes the picker's asset fields in).
 *
 * The rules are the server's (apps/backend/src/lib/job-evidence-media.ts) and the unit test reads
 * them from that file:
 *   - the photo travels as `data:image/<type>;base64,<bytes>` — a link or a storage key is refused;
 *   - JPEG, PNG or WebP only, judged from the BYTES, never from the declared type;
 *   - at most 8 MiB decoded per photo, at most 4 photos in one upload (12 current photos per stage
 *     and 40 rows per job are enforced server-side only — the app cannot count them reliably);
 *   - HEIC / HEIF / AVIF is refused on purpose (evidence is viewed in browsers that cannot render it).
 *
 * HOW THE UI AVOIDS HEIC — verified in the installed expo-image-picker 17.0.11 sources, not assumed:
 *
 *   iOS, camera (`launchCameraAsync`): the capture is re-encoded with `jpegData(compressionQuality:)`
 *     (ios/ImageUtils.swift, default branch) — always JPEG. Safe.
 *
 *   iOS, library (`launchImageLibraryAsync`, PHPicker): `quality < 1` does NOT convert HEIC.
 *     `readDataAndFileExtension(image:rawData:itemProvider:options:)` has
 *     `case UTType.heic.identifier: return (rawData, ".heic")` with no reference to `quality`, so an
 *     iPhone HEIC photo comes back as raw HEIC bytes (`mimeType: "image/heic"`, and `base64` is HEIC).
 *     `exif: false` has no bearing on the format. The native default representation mode is
 *     `.current` (ios/ImagePickerOptions.swift:44) although the TS docs say "automatic". The lever
 *     the package offers is `preferredAssetRepresentationMode:
 *     UIImagePickerPreferredAssetRepresentationMode.Compatible`, which asks PHPicker to hand over
 *     "the most compatible asset representation" (JPEG for a HEIC original — Apple's behaviour, NOT
 *     verifiable here without a device). So: pass `Compatible` for library picks, prefer the camera
 *     for evidence, and ALWAYS run the result through `checkEvidencePhoto` — it is the guarantee.
 *
 *   Android, `quality < 1` with `base64: true`: `CompressionImageExporter.data()` always produces
 *     JPEG bytes for `base64`, while `asset.mimeType` stays the SOURCE type (e.g. "image/heic" or
 *     "image/png"). So `asset.mimeType` must not be used to label the data URL — the code that built
 *     `data:${asset.mimeType};base64,…` mislabelled these. `checkEvidencePhoto` labels by the bytes.
 *     With `quality: 1` the original file is copied untouched (RawImageExporter): HEIC stays HEIC.
 *
 *   expo-image-manipulator (which could convert) is not installed in this app.
 *
 * Recommended picker options for evidence:
 *   { mediaTypes: ["images"], quality: 0.7, base64: true, exif: false,
 *     preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Compatible }
 */

export const EVIDENCE_ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type EvidenceMimeType = (typeof EVIDENCE_ALLOWED_MIME_TYPES)[number];
/** Largest decoded photo the server accepts (MAX_EVIDENCE_PHOTO_BYTES). */
export const EVIDENCE_MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** Photos accepted in one upload (MAX_EVIDENCE_PHOTOS_PER_UPLOAD). */
export const EVIDENCE_MAX_PHOTOS_PER_UPLOAD = 4;

/**
 * Completion photos travel together in ONE `/complete` request, and the server refuses any request
 * body over 25 MB before a route runs (apps/backend/src/index.ts, `maxRequestBodySize`) — with no
 * envelope, so the partner would only see a dropped connection. Four photos the per-photo rule
 * allows (8 MiB each, ~11.2M characters as base64) do not fit. This is the phone's budget for the
 * photos of one request, in data-URL characters; the unit test reads the server's cap.
 */
export const EVIDENCE_MAX_REQUEST_CHARS = 20 * 1024 * 1024;
export const EVIDENCE_REQUEST_TOO_LARGE_MESSAGE = "These photos are too large to send together. Remove one, or add a smaller photo.";

/** Whether `next` can be staged beside the photos already waiting for the same request. */
export function stagedPhotosFit(stagedDataUrls: readonly string[], next: string): { ok: true } | { ok: false; message: string } {
  let chars = next.length;
  for (const url of stagedDataUrls) chars += url.length;
  return chars > EVIDENCE_MAX_REQUEST_CHARS ? { ok: false, message: EVIDENCE_REQUEST_TOO_LARGE_MESSAGE } : { ok: true };
}

export type EvidenceStage = "ARRIVAL" | "START" | "COMPLETION";

/**
 * The refusal codes of `POST /api/bookings/:id/evidence` (and of `photos` on `/complete`) with the
 * HTTP status each arrives with. Several cases share EVIDENCE_MEDIA_INVALID — only the server's
 * sentence (`error.message`) tells them apart, so show that sentence.
 */
export const EVIDENCE_REFUSALS = {
  /** Not an image / a link / a storage key / HEIC-HEIF-AVIF / more than 4 photos. */
  EVIDENCE_MEDIA_INVALID: 400,
  /** A photo over 8 MiB decoded. */
  EVIDENCE_MEDIA_TOO_LARGE: 413,
  /** The same photo already used on another stage or another job. */
  EVIDENCE_MEDIA_DUPLICATE: 409,
  /** The stage holds 12 current photos, or the job 40 evidence rows. */
  EVIDENCE_LIMIT_REACHED: 409,
  /** The job is not ACCEPTED / ASSIGNED / EN_ROUTE / IN_PROGRESS. */
  BOOKING_NOT_ACTIVE: 409,
  /** "Invalid stage". */
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  /** Not the assigned partner (also the route's catch-all). */
  FORBIDDEN: 403,
} as const;
export type EvidenceRefusalCode = keyof typeof EVIDENCE_REFUSALS;

/** The server's own sentences (job-evidence-media.ts `evidenceRefusal`), so a local refusal reads the same. */
export const EVIDENCE_HEIC_MESSAGE = "This photo format (HEIC) is not supported. Send JPEG or PNG.";
export const EVIDENCE_TOO_LARGE_MESSAGE = `That photo is too large. Send one under ${EVIDENCE_MAX_PHOTO_BYTES / (1024 * 1024)} MB.`;
/** App-side, after the server's sentence: what the partner can actually do about it (the app cannot shrink a photo). */
export const EVIDENCE_TOO_LARGE_REMEDY = "Lower the photo size in your camera's settings and take it again.";
export const EVIDENCE_TOO_MANY_MESSAGE = `At most ${EVIDENCE_MAX_PHOTOS_PER_UPLOAD} photos can be sent at once`;
export const EVIDENCE_UNSUPPORTED_MESSAGE = "Send the photo itself (JPEG, PNG or WebP). A link is not accepted as evidence.";
/** App-side only: the picker returned no bytes (it was not asked for `base64`, or reading failed). */
export const EVIDENCE_NO_DATA_MESSAGE = "That photo could not be read. Take or choose it again.";

/** ISO-BMFF brands the server refuses as the HEIF family (HEIF_BRANDS in job-evidence-media.ts). */
const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs", "mif1", "msf1", "heif", "avif", "avis"]);

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** The first `count` decoded bytes of a base64 string (whitespace skipped); fewer if it is shorter or invalid. */
function headBytes(base64: string, count: number): number[] {
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < base64.length && out.length < count; i++) {
    const ch = base64[i]!;
    if (ch === "=" ) break;
    if (ch === "\n" || ch === "\r" || ch === " " || ch === "\t") continue;
    const v = B64.indexOf(ch);
    if (v < 0) return out;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** Decoded size of a base64 string in bytes, ignoring whitespace and padding. No allocation. */
export function decodedBase64Bytes(base64: string): number {
  let chars = 0;
  for (let i = 0; i < base64.length; i++) {
    const c = base64.charCodeAt(i);
    // skip whitespace (space, \t, \n, \r) and '='
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 61) continue;
    chars++;
  }
  return Math.floor((chars * 6) / 8);
}

/**
 * The image type the bytes ARE: "image/jpeg" | "image/png" | "image/webp", or "image/heic" /
 * "image/avif" for the HEIF family, or null for anything else (GIF, BMP, text, not base64).
 */
export function sniffImageMime(base64: string): EvidenceMimeType | "image/heic" | "image/avif" | null {
  const b = headBytes(base64 ?? "", 12);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 12) {
    const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
    if (ascii(4, 8) === "ftyp") {
      const brand = ascii(8, 12).toLowerCase();
      if (brand === "avif" || brand === "avis") return "image/avif";
      if (HEIF_BRANDS.has(brand)) return "image/heic";
    }
  }
  return null;
}

/** What the screen passes in from an `ImagePickerAsset`. Only `base64` decides; the rest is context. */
export type PickedPhoto = {
  base64?: string | null;
  /** The picker's claim. NOT trusted (Android reports the source type for re-encoded bytes). */
  mimeType?: string | null;
  uri?: string | null;
};

export type EvidencePhotoRefusal = {
  ok: false;
  reason: "NO_DATA" | "HEIC" | "UNSUPPORTED_TYPE" | "TOO_LARGE";
  /** The code the SERVER would answer with (NO_DATA has no server twin: it is EVIDENCE_MEDIA_INVALID too). */
  code: EvidenceRefusalCode;
  status: number;
  message: string;
};

export type EvidencePhotoCheck =
  | { ok: true; mimeType: EvidenceMimeType; bytes: number; /** Ready for `mediaUrl` / `photos[]`. */ dataUrl: string }
  | EvidencePhotoRefusal;

const refuse = (reason: EvidencePhotoRefusal["reason"], code: EvidenceRefusalCode, message: string): EvidencePhotoRefusal => ({
  ok: false,
  reason,
  code,
  status: EVIDENCE_REFUSALS[code],
  message,
});

export function checkEvidencePhoto(photo: PickedPhoto): EvidencePhotoCheck {
  const base64 = typeof photo.base64 === "string" ? photo.base64 : "";
  if (!base64) return refuse("NO_DATA", "EVIDENCE_MEDIA_INVALID", EVIDENCE_NO_DATA_MESSAGE);
  const mime = sniffImageMime(base64);
  if (mime === "image/heic" || mime === "image/avif") return refuse("HEIC", "EVIDENCE_MEDIA_INVALID", EVIDENCE_HEIC_MESSAGE);
  if (mime === null) return refuse("UNSUPPORTED_TYPE", "EVIDENCE_MEDIA_INVALID", EVIDENCE_UNSUPPORTED_MESSAGE);
  const bytes = decodedBase64Bytes(base64);
  if (bytes > EVIDENCE_MAX_PHOTO_BYTES) return refuse("TOO_LARGE", "EVIDENCE_MEDIA_TOO_LARGE", EVIDENCE_TOO_LARGE_MESSAGE);
  return { ok: true, mimeType: mime, bytes, dataUrl: `data:${mime};base64,${base64}` };
}

export type EvidenceBatchCheck =
  | { ok: true; dataUrls: string[] }
  | { ok: false; reason: EvidencePhotoRefusal["reason"] | "TOO_MANY"; code: EvidenceRefusalCode; status: number; message: string; /** Which photo was refused; absent for TOO_MANY / an empty batch. */ index?: number };

/** One upload: 1–4 photos, every one sendable. The first refused photo refuses the batch. */
export function checkEvidenceBatch(photos: readonly PickedPhoto[]): EvidenceBatchCheck {
  if (photos.length === 0) return { ok: false, reason: "NO_DATA", code: "EVIDENCE_MEDIA_INVALID", status: EVIDENCE_REFUSALS.EVIDENCE_MEDIA_INVALID, message: EVIDENCE_NO_DATA_MESSAGE };
  if (photos.length > EVIDENCE_MAX_PHOTOS_PER_UPLOAD) {
    return { ok: false, reason: "TOO_MANY", code: "EVIDENCE_MEDIA_INVALID", status: EVIDENCE_REFUSALS.EVIDENCE_MEDIA_INVALID, message: EVIDENCE_TOO_MANY_MESSAGE };
  }
  const dataUrls: string[] = [];
  for (let index = 0; index < photos.length; index++) {
    const r = checkEvidencePhoto(photos[index]!);
    if (!r.ok) return { ok: false, reason: r.reason, code: r.code, status: r.status, message: r.message, index };
    dataUrls.push(r.dataUrl);
  }
  return { ok: true, dataUrls };
}

/**
 * The `clientUploadId` for one picked photo. The server is idempotent on (booking, stage,
 * clientUploadId): build the id ONCE when the photo is picked and reuse it on a retry, so a retry
 * returns the row already written instead of adding a second photo.
 */
export function evidenceUploadId(stage: EvidenceStage, pickedAtMs: number, scope?: string): string {
  return `m-${stage.toLowerCase()}${scope ? `-${scope}` : ""}-${pickedAtMs}`;
}

/**
 * An evidence row's `mediaAccessUrl` is a path on the API (`/api/bookings/:id/evidence/:eid/media`)
 * that answers only the signed-in reader: an `Image` needs the bearer header for it
 * (`partnerApi.evidenceImageSource`). Anything else is opened as it is.
 */
export function isApiMediaPath(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith("/api/");
}

/** What React Native's `<Image source>` takes. */
export type EvidenceImageSource = { uri: string; headers?: { Authorization: string } };

/**
 * The `Image` source for an evidence row's `mediaAccessUrl`. An API path gets this app's API base
 * and the bearer header — and the token is attached ONLY to an API path, never to another host. Null
 * when the row has no stored photo, or when an API path has no token to send.
 */
export function evidenceImageSourceFor(mediaAccessUrl: string | null | undefined, apiBaseUrl: string, token: string | null): EvidenceImageSource | null {
  if (typeof mediaAccessUrl !== "string" || !mediaAccessUrl) return null;
  if (!isApiMediaPath(mediaAccessUrl)) return { uri: mediaAccessUrl };
  if (!token) return null;
  return { uri: `${apiBaseUrl.replace(/\/+$/, "")}${mediaAccessUrl}`, headers: { Authorization: `Bearer ${token}` } };
}
