import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { AppError } from "../lib/app-error";
import { parseDdlTarget } from "../lib/ddl-target-guard";
import { generateStorageKey } from "../lib/storage-key";
import { logger } from "../lib/logger";
import { liveProviderAllowed } from "../lib/test-egress";

export type StorageNamespace =
  | "chargeback-evidence"
  | "compliance-exports"
  | "support-attachments"
  | "admin-uploads"
  | "job-evidence"
  | "rating-photos";

const LOCAL_ROOT = process.env.LOCAL_UPLOAD_ROOT || path.join(process.cwd(), "uploads");
const SIGNED_URL_TTL_SEC = Number(process.env.S3_SIGNED_URL_TTL_SEC ?? 300);

/* ------------------------------------------------------------------------------------------------
 * Typed storage failures
 *
 * Every storage failure leaves this module as a StorageError (an AppError), so the error middleware
 * renders a deterministic status + code instead of an UNKNOWN 500. Bucket names and object keys stay
 * out of the client-facing message; they go to the structured log only.
 * ---------------------------------------------------------------------------------------------- */

export type StorageErrorCode =
  | "STORAGE_PRODUCTION_TARGET_FORBIDDEN"
  | "STORAGE_NOT_CONFIGURED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_ACCESS_DENIED"
  | "STORAGE_OBJECT_NOT_FOUND"
  | "STORAGE_INVALID_KEY"
  | "STORAGE_WRITE_FAILED";

const STORAGE_STATUS: Record<StorageErrorCode, number> = {
  STORAGE_PRODUCTION_TARGET_FORBIDDEN: 503,
  STORAGE_NOT_CONFIGURED: 503,
  STORAGE_UNAVAILABLE: 503,
  STORAGE_ACCESS_DENIED: 503,
  STORAGE_OBJECT_NOT_FOUND: 404,
  STORAGE_INVALID_KEY: 400,
  STORAGE_WRITE_FAILED: 502,
};

const STORAGE_MESSAGE: Record<StorageErrorCode, string> = {
  STORAGE_PRODUCTION_TARGET_FORBIDDEN: "File storage is not available in this environment",
  STORAGE_NOT_CONFIGURED: "File storage is not configured",
  STORAGE_UNAVAILABLE: "File storage is temporarily unavailable",
  STORAGE_ACCESS_DENIED: "File storage refused the request",
  STORAGE_OBJECT_NOT_FOUND: "File not found",
  STORAGE_INVALID_KEY: "Invalid file reference",
  STORAGE_WRITE_FAILED: "The file could not be stored",
};

export class StorageError extends AppError {
  constructor(code: StorageErrorCode, meta?: Record<string, unknown>) {
    super(STORAGE_MESSAGE[code], STORAGE_STATUS[code], code, { meta });
    this.name = "StorageError";
  }
}

/* ------------------------------------------------------------------------------------------------
 * Target resolution — environment-aware, fail-closed
 *
 * The bucket used to be "whatever AWS_S3_BUCKET says". A development-mode backend pointed at a
 * disposable test database (the isolated E2E stack) therefore uploaded chargeback evidence to the
 * production bucket named in `.env`; only an egress barrier stopped it (2026-10-01). Network
 * blocking is not a storage control, so the target is now decided here, before any client exists:
 *
 *   - test runtime (NODE_ENV=test, lib/test-egress)          → local disk, always
 *   - OBJECT_STORAGE_DRIVER=local                             → local disk (explicit test/dev adapter)
 *   - no AWS_S3_BUCKET                                        → local disk (or STORAGE_NOT_CONFIGURED
 *                                                               when OBJECT_STORAGE_DRIVER=s3 demands S3)
 *   - AWS_S3_BUCKET + the data store is a TEST database       → REFUSED (STORAGE_PRODUCTION_TARGET_FORBIDDEN)
 *                                                               unless AWS_S3_BUCKET_ENVIRONMENT=test
 *                                                               declares the bucket disposable; objects
 *                                                               then live under `test/<database>/…`
 *   - AWS_S3_BUCKET + a non-test database                     → S3, unchanged
 *
 * "Test database" is the same predicate every write-capable script uses (lib/ddl-target-guard):
 * test data must never land next to production data, whatever network the machine has.
 * ---------------------------------------------------------------------------------------------- */

export type StorageTarget =
  | { kind: "local" }
  | { kind: "s3"; bucket: string; keyPrefix: string };

export function resolveStorageTarget(env: NodeJS.ProcessEnv = process.env): StorageTarget {
  // No S3 from a test runtime (lib/test-egress.ts) unless a suite opts in with HOMIGO_REQUIRE_S3=1.
  const testRuntime =
    env === process.env ? !liveProviderAllowed("HOMIGO_REQUIRE_S3") : env.NODE_ENV === "test" && env.HOMIGO_REQUIRE_S3 !== "1";
  if (testRuntime) return { kind: "local" };
  const driver = env.OBJECT_STORAGE_DRIVER?.trim().toLowerCase();
  if (driver && driver !== "local" && driver !== "s3") {
    throw new StorageError("STORAGE_NOT_CONFIGURED", { reason: "unknown OBJECT_STORAGE_DRIVER" });
  }
  if (driver === "local") return { kind: "local" };

  const bucket = env.AWS_S3_BUCKET?.trim();
  if (!bucket) {
    if (driver === "s3") throw new StorageError("STORAGE_NOT_CONFIGURED", { reason: "OBJECT_STORAGE_DRIVER=s3 without AWS_S3_BUCKET" });
    return { kind: "local" };
  }

  const data = parseDdlTarget(env.DATABASE_URL);
  if (data?.isTestDatabase) {
    if (env.AWS_S3_BUCKET_ENVIRONMENT?.trim().toLowerCase() !== "test") {
      throw new StorageError("STORAGE_PRODUCTION_TARGET_FORBIDDEN", {
        reason: "test database with a bucket not declared AWS_S3_BUCKET_ENVIRONMENT=test",
        database: data.database,
      });
    }
    return { kind: "s3", bucket, keyPrefix: `test/${data.database}/` };
  }
  return { kind: "s3", bucket, keyPrefix: "" };
}

function region(): string {
  return process.env.AWS_REGION || "ap-south-1";
}

function s3Client(): S3Client {
  return new S3Client({ region: region() });
}

/**
 * A key is one or more "/"-separated segments; every segment must be a plain name. Anything else is
 * refused rather than rewritten.
 *
 * Keys used to be flattened with path.basename(), so `vision/<ownerA>/<hash>` and
 * `vision/<ownerB>/<hash>` became the SAME object: identical bytes from two owners shared one file,
 * and one owner's retention delete removed the other's image (homigo_db held 2 vision rows on 1 object
 * on 2026-10-01). Segments are now kept, so owners are isolated by construction.
 */
function keySegments(storageKey: string): string[] {
  const key = typeof storageKey === "string" ? storageKey : "";
  const segments = key.split("/");
  const ok =
    key.length > 0 &&
    key.length <= 512 &&
    segments.every((s) => s.length > 0 && s === s.trim() && s !== "." && s !== ".." && !/[\\\0]/.test(s));
  if (!ok) throw new StorageError("STORAGE_INVALID_KEY");
  return segments;
}

function objectKey(target: { keyPrefix: string }, namespace: StorageNamespace, storageKey: string): string {
  return `${target.keyPrefix}${namespace}/${keySegments(storageKey).join("/")}`;
}

/** Where a multi-segment key was written before segments were kept (basename only), or null. */
function legacyFlatKey(storageKey: string): string | null {
  const segments = keySegments(storageKey);
  return segments.length > 1 ? segments[segments.length - 1]! : null;
}

/**
 * mkdir -p that tolerates an existing directory. Bun 1.3 on Windows throws EEXIST from
 * `mkdirSync(existingDir, { recursive: true })` for some existing directories (reproduced on
 * apps/backend/uploads/chargeback-evidence), contrary to Node's contract.
 */
function ensureDir(dir: string): void {
  if (fs.existsSync(dir)) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EEXIST" && fs.statSync(dir).isDirectory()) return;
    throw err;
  }
}

function localPath(namespace: StorageNamespace, storageKey: string): string {
  const segments = keySegments(storageKey);
  const dir = path.join(LOCAL_ROOT, namespace);
  const filePath = path.join(dir, ...segments);
  if (!filePath.startsWith(dir + path.sep)) throw new StorageError("STORAGE_INVALID_KEY");
  ensureDir(path.dirname(filePath));
  return filePath;
}

/** Map an AWS SDK / transport failure to a typed error. Never rethrows the raw SDK error. */
export function translateS3Error(err: unknown, op: string, namespace: StorageNamespace): StorageError {
  if (err instanceof StorageError) return err;
  const e = err as { name?: string; code?: string; $metadata?: { httpStatusCode?: number }; message?: string };
  const status = e?.$metadata?.httpStatusCode;
  const name = e?.name ?? e?.code ?? "";
  let code: StorageErrorCode;
  if (status === 404 || name === "NoSuchKey" || name === "NotFound") code = "STORAGE_OBJECT_NOT_FOUND";
  else if (status === 403 || name === "AccessDenied" || name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch")
    code = "STORAGE_ACCESS_DENIED";
  else if (status === 400 && (name === "InvalidObjectName" || name === "KeyTooLongError")) code = "STORAGE_INVALID_KEY";
  else if (status != null && status >= 400 && status < 500) code = "STORAGE_WRITE_FAILED";
  else code = "STORAGE_UNAVAILABLE"; // network, timeout, DNS, 5xx, egress barrier
  logger.warn("object_storage.failed", { op, namespace, code, awsName: name || undefined, httpStatus: status });
  return new StorageError(code, { op });
}

export type StoredObject = {
  storageKey: string;
  fileUrl: string | null;
  fileSize: number;
  fileHash: string;
  backend: "s3" | "local";
  mimeType: string;
};

export class ObjectStorageService {
  /** True when objects are served from S3. A refused target reads as "not S3", never as a throw. */
  isS3Enabled(): boolean {
    try {
      return resolveStorageTarget().kind === "s3";
    } catch {
      return false;
    }
  }

  async putObject(
    namespace: StorageNamespace,
    body: Buffer,
    opts: { fileName: string; mimeType: string; storageKey?: string },
  ): Promise<StoredObject> {
    const storageKey = opts.storageKey ?? generateStorageKey();
    const fileHash = crypto.createHash("sha256").update(body).digest("hex");
    // Decided BEFORE any client is built or any byte leaves the process.
    const target = resolveStorageTarget();

    if (target.kind === "s3") {
      const key = objectKey(target, namespace, storageKey);
      try {
        await s3Client().send(
          new PutObjectCommand({
            Bucket: target.bucket,
            Key: key,
            Body: body,
            ContentType: opts.mimeType,
            ServerSideEncryption: "AES256",
            Metadata: {
              originalName: opts.fileName.slice(0, 200),
              sha256: fileHash,
            },
          }),
        );
      } catch (err) {
        throw translateS3Error(err, "put", namespace);
      }
      return {
        storageKey,
        fileUrl: `s3://${target.bucket}/${key}`,
        fileSize: body.length,
        fileHash,
        backend: "s3",
        mimeType: opts.mimeType,
      };
    }

    const filePath = localPath(namespace, storageKey);
    try {
      fs.writeFileSync(filePath, body);
    } catch (err) {
      logger.warn("object_storage.local_put_failed", { namespace, error: (err as Error)?.message });
      throw new StorageError("STORAGE_WRITE_FAILED", { op: "put" });
    }
    logger.info("object_storage.local_put", { namespace, storageKey, bytes: body.length });
    return {
      storageKey,
      fileUrl: null,
      fileSize: body.length,
      fileHash,
      backend: "local",
      mimeType: opts.mimeType,
    };
  }

  async getObjectBuffer(namespace: StorageNamespace, storageKey: string): Promise<Buffer> {
    const target = resolveStorageTarget();
    const legacy = legacyFlatKey(storageKey);
    if (target.kind === "s3") {
      const read = async (key: string): Promise<Buffer> => {
        try {
          const res = await s3Client().send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
          const stream = res.Body;
          if (!stream || typeof stream === "string") throw new StorageError("STORAGE_OBJECT_NOT_FOUND");
          const chunks: Uint8Array[] = [];
          for await (const chunk of stream as AsyncIterable<Uint8Array>) {
            chunks.push(chunk);
          }
          return Buffer.concat(chunks);
        } catch (err) {
          throw translateS3Error(err, "get", namespace);
        }
      };
      try {
        return await read(objectKey(target, namespace, storageKey));
      } catch (err) {
        if (!legacy || (err as StorageError).code !== "STORAGE_OBJECT_NOT_FOUND") throw err;
        return read(objectKey(target, namespace, legacy));
      }
    }

    const filePath = localPath(namespace, storageKey);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    const legacyPath = legacy ? localPath(namespace, legacy) : null;
    if (legacyPath && fs.existsSync(legacyPath)) return fs.readFileSync(legacyPath);
    throw new StorageError("STORAGE_OBJECT_NOT_FOUND");
  }

  /**
   * Deletes the object at its own key only. A legacy flattened object (see keySegments) may be shared
   * by several owners, so it is never deleted on one owner's behalf.
   */
  async deleteObject(namespace: StorageNamespace, storageKey: string): Promise<void> {
    const target = resolveStorageTarget();
    if (target.kind === "s3") {
      try {
        await s3Client().send(
          new DeleteObjectCommand({ Bucket: target.bucket, Key: objectKey(target, namespace, storageKey) }),
        );
      } catch (err) {
        throw translateS3Error(err, "delete", namespace);
      }
      return;
    }
    const filePath = localPath(namespace, storageKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  /** false only when the object is genuinely absent; denial/outage throws instead of reading as "missing". */
  async headObject(namespace: StorageNamespace, storageKey: string): Promise<boolean> {
    const target = resolveStorageTarget();
    const legacy = legacyFlatKey(storageKey);
    if (target.kind === "s3") {
      const head = async (key: string): Promise<boolean> => {
        try {
          await s3Client().send(new HeadObjectCommand({ Bucket: target.bucket, Key: key }));
          return true;
        } catch (err) {
          const typed = translateS3Error(err, "head", namespace);
          if (typed.code === "STORAGE_OBJECT_NOT_FOUND") return false;
          throw typed;
        }
      };
      if (await head(objectKey(target, namespace, storageKey))) return true;
      return legacy ? head(objectKey(target, namespace, legacy)) : false;
    }
    if (fs.existsSync(localPath(namespace, storageKey))) return true;
    return legacy ? fs.existsSync(localPath(namespace, legacy)) : false;
  }

  async createSignedDownloadUrl(
    namespace: StorageNamespace,
    storageKey: string,
    ttlSec = SIGNED_URL_TTL_SEC,
  ): Promise<string> {
    const target = resolveStorageTarget();
    if (target.kind !== "s3") throw new StorageError("STORAGE_NOT_CONFIGURED", { reason: "signed URLs need S3" });
    try {
      return await getSignedUrl(
        s3Client(),
        new GetObjectCommand({ Bucket: target.bucket, Key: objectKey(target, namespace, storageKey) }),
        { expiresIn: ttlSec },
      );
    } catch (err) {
      throw translateS3Error(err, "sign", namespace);
    }
  }

  resolveLocalPath(namespace: StorageNamespace, storageKey: string): string {
    return localPath(namespace, storageKey);
  }
}

export const objectStorageService = new ObjectStorageService();
