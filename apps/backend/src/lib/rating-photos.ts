/**
 * Rating photos (2026-10-01).
 *
 * Three defects, one module:
 *   1. The upload returned a URL built from the client's own Host / X-Forwarded-Proto headers.
 *   2. Rating create/update accepted ANY string as a photo URL — any signed-in customer could attach an
 *      arbitrary external URL (a tracking pixel, hosted content) to a review other people see.
 *   3. Files were written to the backend's local disk, which a container platform wipes on restart and
 *      does not share between instances. They now go through object storage (namespace "rating-photos").
 *
 * A rating may only reference photos its author uploaded through POST /api/uploads/ratings, and the
 * stored URL is rebuilt from a trusted origin rather than kept as the client sent it.
 */
import fs from "node:fs";
import path from "node:path";
import { devAffordancesAllowed } from "./deployed-environment";
import { objectStorageService } from "../services/object-storage.service";

export const RATING_PHOTO_NAMESPACE = "rating-photos" as const;
export const MAX_RATING_PHOTOS = 6;
/** Pre-object-storage location; still served (read-only) so photos uploaded before the move keep working. */
export const LEGACY_RATINGS_DIR = path.join(process.cwd(), "uploads", "ratings");

const NAME = /^([a-z0-9]{8,40})-(\d{10,16})-([0-9a-f]{8})\.(jpg|png|webp)$/;

export type ImageExt = ".jpg" | ".png" | ".webp";

/** The image type from the file's own bytes — never the client-declared MIME type. */
export function detectImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return ".webp";
  return null;
}

export function isRatingPhotoName(name: string): boolean {
  return NAME.test(name);
}

/** The configured public origin of this API, or null. Required on a deployed production host. */
export function publicApiOrigin(): string | null {
  const raw = process.env.PUBLIC_API_ORIGIN?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * The URL handed back for a stored photo. Never built from request headers on a deployed host: with no
 * configured origin it is the path alone, which the client resolves against the API it already uses.
 */
export function ratingPhotoUrl(name: string, request?: Request): string {
  const rel = `/uploads/ratings/${name}`;
  const origin = publicApiOrigin();
  if (origin) return `${origin}${rel}`;
  if (request && devAffordancesAllowed()) {
    const host = request.headers.get("host") ?? "localhost:3000";
    const proto = request.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${host}${rel}`;
  }
  return rel;
}

/** The photo file name a URL (absolute or path) refers to, or null if it is not one of ours. */
function nameFromUrl(value: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(value, "http://relative.invalid").pathname;
  } catch {
    return null;
  }
  const m = /^\/uploads\/ratings\/([^/]+)$/.exec(pathname);
  return m && isRatingPhotoName(m[1]!) ? m[1]! : null;
}

async function photoExists(name: string): Promise<boolean> {
  if (fs.existsSync(path.join(LEGACY_RATINGS_DIR, name))) return true;
  return objectStorageService.headObject(RATING_PHOTO_NAMESPACE, name);
}

/**
 * Validate the photos a rating references and return them canonicalised, or null when any is not a
 * photo this user uploaded (wrong host path, someone else's file, a file that does not exist) or there
 * are too many.
 */
export async function canonicalOwnRatingPhotos(userId: string, photos: string[] | undefined): Promise<string[] | null> {
  if (!photos || photos.length === 0) return [];
  if (photos.length > MAX_RATING_PHOTOS) return null;
  const out: string[] = [];
  for (const value of photos) {
    const name = typeof value === "string" ? nameFromUrl(value) : null;
    if (!name || NAME.exec(name)![1] !== userId.toLowerCase()) return null;
    if (!(await photoExists(name))) return null;
    // With a configured origin, or on any deployed host, the stored URL is rebuilt — never the client's
    // host. Only a developer machine without one keeps the (validated) URL it was given.
    out.push(publicApiOrigin() || !devAffordancesAllowed() ? ratingPhotoUrl(name) : value);
  }
  return out;
}
