import { Elysia, t } from "elysia";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { authPlugin } from "../plugins/auth.plugin";

/**
 * Image upload endpoint for user-generated content (rating photos).
 *
 * Stores files on local disk (dev) under `uploads/ratings/` and serves them
 * statically at `/uploads/ratings/*`. Mirrors the existing partner
 * document-upload pattern; swap the storage for S3 in production without
 * changing the API contract (`{ success, data: { url } }`).
 */

const RATINGS_DIR = path.join(process.cwd(), "uploads", "ratings");
const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8MB — matches the dropzone copy
const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

// Ensure the directory exists before the static plugin binds to it.
if (!fs.existsSync(RATINGS_DIR)) fs.mkdirSync(RATINGS_DIR, { recursive: true });

function absoluteUrl(request: Request, relPath: string): string {
  const host = request.headers.get("host") ?? "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}${relPath}`;
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const uploadsRoutes = new Elysia({ name: "uploads" })
  // Serve ONLY rating photos, resolved per-request from disk (so files uploaded
  // after startup are served). basename() blocks path traversal; partner
  // documents live in a different dir and stay private.
  .get("/uploads/ratings/:name", ({ params, set }) => {
    const safeName = path.basename(params.name);
    const filePath = path.join(RATINGS_DIR, safeName);
    if (!filePath.startsWith(RATINGS_DIR) || !fs.existsSync(filePath)) {
      set.status = 404;
      return { success: false, error: "Image not found", code: "NOT_FOUND" };
    }
    const ext = path.extname(safeName).toLowerCase();
    set.headers["Content-Type"] = CONTENT_TYPE_BY_EXT[ext] ?? "application/octet-stream";
    set.headers["Cache-Control"] = "public, max-age=86400";
    return new Response(fs.readFileSync(filePath));
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
      const ext = EXT_BY_TYPE[file.type];
      if (!ext) {
        set.status = 400;
        return {
          success: false,
          error: "Only JPG, PNG or WEBP images are allowed",
          code: "VALIDATION_ERROR",
        };
      }
      if (file.size > MAX_FILE_SIZE) {
        set.status = 400;
        return { success: false, error: "Image exceeds the 8MB limit", code: "VALIDATION_ERROR" };
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const name = `${userId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
      fs.writeFileSync(path.join(RATINGS_DIR, name), buffer);

      const url = absoluteUrl(request, `/uploads/ratings/${name}`);
      set.status = 201;
      return { success: true, data: { url } };
    },
    {
      // Accept a single multipart file field named "file".
      body: t.Object({ file: t.File({ maxSize: "8m" }) }),
    },
  );
