import { Elysia, t } from "elysia";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { authPlugin } from "../plugins/auth.plugin";
import { objectStorageService } from "../services/object-storage.service";
import {
  LEGACY_RATINGS_DIR,
  RATING_PHOTO_NAMESPACE,
  detectImageType,
  isRatingPhotoName,
  ratingPhotoUrl,
  type ImageExt,
} from "../lib/rating-photos";

/**
 * Image upload endpoint for user-generated content (rating photos).
 *
 * Contract unchanged: `POST /api/uploads/ratings` → `{ success, data: { url } }`, served at
 * `GET /uploads/ratings/:name`. Since 2026-10-01 (lib/rating-photos):
 *   - stored through object storage (namespace "rating-photos"), not the backend's local disk, which a
 *     container platform wipes on restart; photos written to the old directory are still served;
 *   - the type comes from the file's bytes, not the client-declared MIME type;
 *   - the returned URL is built from PUBLIC_API_ORIGIN, never the request's Host header on a
 *     deployed host.
 */

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — matches the dropzone copy
const ALLOWED_DECLARED_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const uploadsRoutes = new Elysia({ name: "uploads" })
  // Serve ONLY rating photos. The name must match the generated pattern (no traversal possible), and
  // is looked up in the pre-object-storage directory first, then in object storage.
  .get("/uploads/ratings/:name", async ({ params, set }) => {
    const safeName = path.basename(params.name);
    if (!isRatingPhotoName(safeName)) {
      set.status = 404;
      return { success: false, error: "Image not found", code: "NOT_FOUND" };
    }
    const ext = path.extname(safeName).toLowerCase();
    const headers = {
      "Content-Type": CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    };
    const legacy = path.join(LEGACY_RATINGS_DIR, safeName);
    if (fs.existsSync(legacy)) return new Response(fs.readFileSync(legacy), { headers });
    if (!(await objectStorageService.headObject(RATING_PHOTO_NAMESPACE, safeName))) {
      set.status = 404;
      return { success: false, error: "Image not found", code: "NOT_FOUND" };
    }
    return new Response(await objectStorageService.getObjectBuffer(RATING_PHOTO_NAMESPACE, safeName), { headers });
  })
  .use(authPlugin)
  .post(
    "/api/uploads/ratings",
    async ({ requireAuth, request, body, set }) => {
      const { userId } = requireAuth();
      const file = body.file;

      if (!file || typeof file === "string") {
        set.status = 400;
        return { success: false, error: "No image provided", code: "VALIDATION_ERROR" };
      }
      if (file.size > MAX_FILE_SIZE) {
        set.status = 400;
        return { success: false, error: "Image exceeds the 8MB limit", code: "VALIDATION_ERROR" };
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const ext: ImageExt | null = ALLOWED_DECLARED_TYPES.has(file.type) ? detectImageType(buffer) : null;
      if (!ext) {
        set.status = 400;
        return {
          success: false,
          error: "Only JPG, PNG or WEBP images are allowed",
          code: "VALIDATION_ERROR",
        };
      }

      const name = `${userId.toLowerCase()}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      await objectStorageService.putObject(RATING_PHOTO_NAMESPACE, buffer, {
        fileName: name,
        mimeType: CONTENT_TYPE_BY_EXT[ext]!,
        storageKey: name,
      });

      set.status = 201;
      return { success: true, data: { url: ratingPhotoUrl(name, request) } };
    },
    {
      // Accept a single multipart file field named "file".
      body: t.Object({ file: t.File({ maxSize: "8m" }) }),
    },
  );
