/**
 * Object storage target guard + typed failures (2026-10-01).
 *
 * A development-mode backend on a disposable TEST database uploaded chargeback evidence to the
 * production bucket named in `.env`; only an egress barrier stopped the write. These tests pin the
 * storage-side control: a real bucket next to a test database is refused BEFORE any S3 call, and every
 * storage failure leaves the service as a typed StorageError instead of an UNKNOWN 500.
 */
import { afterAll, afterEach, describe, expect, it, spyOn } from "bun:test";
import fs from "fs";
import path from "path";
import { S3Client } from "@aws-sdk/client-s3";
import { isAppError } from "../lib/app-error";
import {
  StorageError,
  objectStorageService,
  resolveStorageTarget,
  translateS3Error,
} from "../services/object-storage.service";

const TEST_DB = "postgresql://u:p@localhost:5433/homigo_test?schema=public";
const LIVE_DB = "postgresql://u:p@localhost:5432/homigo_db?schema=public";
const base = (extra: Record<string, string | undefined>) =>
  ({ NODE_ENV: "development", ...extra }) as unknown as NodeJS.ProcessEnv;
/** S3Client.send is heavily overloaded; spy on it through a plain signature. */
const s3Proto = S3Client.prototype as unknown as { send: (...args: unknown[]) => Promise<unknown> };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof StorageError ? err.code : `untyped:${(err as Error)?.message}`;
  }
  return "no-throw";
}

describe("resolveStorageTarget", () => {
  it("test runtime never reaches S3 unless a suite opts in", () => {
    expect(resolveStorageTarget(base({ NODE_ENV: "test", AWS_S3_BUCKET: "prod", DATABASE_URL: LIVE_DB }))).toEqual({ kind: "local" });
  });

  it("OBJECT_STORAGE_DRIVER=local is an explicit local adapter even with a bucket configured", () => {
    expect(resolveStorageTarget(base({ OBJECT_STORAGE_DRIVER: "local", AWS_S3_BUCKET: "prod", DATABASE_URL: TEST_DB }))).toEqual({ kind: "local" });
  });

  it("no bucket → local; OBJECT_STORAGE_DRIVER=s3 without a bucket → STORAGE_NOT_CONFIGURED", () => {
    expect(resolveStorageTarget(base({ DATABASE_URL: LIVE_DB }))).toEqual({ kind: "local" });
    expect(codeOf(() => resolveStorageTarget(base({ OBJECT_STORAGE_DRIVER: "s3", DATABASE_URL: LIVE_DB })))).toBe("STORAGE_NOT_CONFIGURED");
  });

  it("an unknown driver is a configuration error, not a silent default", () => {
    expect(codeOf(() => resolveStorageTarget(base({ OBJECT_STORAGE_DRIVER: "gcs", DATABASE_URL: LIVE_DB })))).toBe("STORAGE_NOT_CONFIGURED");
  });

  it("a bucket next to a TEST database is refused (the 2026-10-01 case)", () => {
    expect(codeOf(() => resolveStorageTarget(base({ AWS_S3_BUCKET: "homigo-prod", DATABASE_URL: TEST_DB })))).toBe(
      "STORAGE_PRODUCTION_TARGET_FORBIDDEN",
    );
    // An unrelated environment label is not a declaration.
    expect(
      codeOf(() => resolveStorageTarget(base({ AWS_S3_BUCKET: "homigo-prod", AWS_S3_BUCKET_ENVIRONMENT: "prod", DATABASE_URL: TEST_DB }))),
    ).toBe("STORAGE_PRODUCTION_TARGET_FORBIDDEN");
  });

  it("a bucket declared test is namespaced by database, so test objects never share keys with production", () => {
    expect(resolveStorageTarget(base({ AWS_S3_BUCKET: "homigo-e2e", AWS_S3_BUCKET_ENVIRONMENT: "test", DATABASE_URL: TEST_DB }))).toEqual({
      kind: "s3",
      bucket: "homigo-e2e",
      keyPrefix: "test/homigo_test/",
    });
  });

  it("a non-test database keeps the configured bucket unchanged", () => {
    expect(resolveStorageTarget(base({ AWS_S3_BUCKET: "homigo-prod", DATABASE_URL: LIVE_DB }))).toEqual({
      kind: "s3",
      bucket: "homigo-prod",
      keyPrefix: "",
    });
  });
});

describe("translateS3Error", () => {
  const map = (e: unknown) => translateS3Error(e, "put", "chargeback-evidence").code;
  it("maps SDK/transport failures to deterministic codes", () => {
    expect(map({ name: "NoSuchKey", $metadata: { httpStatusCode: 404 } })).toBe("STORAGE_OBJECT_NOT_FOUND");
    expect(map({ name: "NotFound", $metadata: { httpStatusCode: 404 } })).toBe("STORAGE_OBJECT_NOT_FOUND");
    expect(map({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } })).toBe("STORAGE_ACCESS_DENIED");
    expect(map({ name: "InvalidObjectName", $metadata: { httpStatusCode: 400 } })).toBe("STORAGE_INVALID_KEY");
    expect(map({ name: "EntityTooLarge", $metadata: { httpStatusCode: 400 } })).toBe("STORAGE_WRITE_FAILED");
    expect(map({ name: "InternalError", $metadata: { httpStatusCode: 500 } })).toBe("STORAGE_UNAVAILABLE");
    expect(map({ name: "TimeoutError" })).toBe("STORAGE_UNAVAILABLE");
    expect(map(new TypeError("fetch failed"))).toBe("STORAGE_UNAVAILABLE");
    expect(map(undefined)).toBe("STORAGE_UNAVAILABLE");
  });

  it("renders through the AppError envelope with no bucket or key in the client message", () => {
    const e = translateS3Error({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } }, "put", "chargeback-evidence");
    expect(isAppError(e)).toBe(true);
    expect(e.status).toBe(503);
    expect(e.message).not.toMatch(/s3|bucket|chargeback-evidence/i);
    expect(new StorageError("STORAGE_OBJECT_NOT_FOUND").status).toBe(404);
    expect(new StorageError("STORAGE_INVALID_KEY").status).toBe(400);
  });
});

// The hierarchical-key cases create per-owner directories under the local upload root; leave none behind.
afterAll(() => {
  for (const owner of ["ownerA-guardtest", "ownerB-guardtest", "someOwner-guardtest"]) {
    const dir = path.dirname(objectStorageService.resolveLocalPath("support-attachments", `vision/${owner}/probe`));
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  }
});

describe("ObjectStorageService against a real process env", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of ["HOMIGO_REQUIRE_S3", "AWS_S3_BUCKET", "AWS_S3_BUCKET_ENVIRONMENT", "OBJECT_STORAGE_DRIVER"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("refuses a production bucket next to the test database BEFORE any S3 request", async () => {
    // The suite runs on homigo_test; opting into S3 is the only way past the test-runtime barrier.
    process.env.HOMIGO_REQUIRE_S3 = "1";
    process.env.AWS_S3_BUCKET = "homigo-prod-would-be-written";
    delete process.env.AWS_S3_BUCKET_ENVIRONMENT;
    delete process.env.OBJECT_STORAGE_DRIVER;
    const send = spyOn(s3Proto, "send");
    try {
      const err = await objectStorageService
        .putObject("chargeback-evidence", Buffer.from("%PDF-1.4"), { fileName: "e.pdf", mimeType: "application/pdf" })
        .then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe("STORAGE_PRODUCTION_TARGET_FORBIDDEN");
      expect(send).not.toHaveBeenCalled();
      expect(objectStorageService.isS3Enabled()).toBe(false);
    } finally {
      send.mockRestore();
    }
  });

  it("headObject: absent → false, denial → typed throw (a denial is not 'missing')", async () => {
    process.env.HOMIGO_REQUIRE_S3 = "1";
    process.env.AWS_S3_BUCKET = "homigo-e2e";
    process.env.AWS_S3_BUCKET_ENVIRONMENT = "test";
    const send = spyOn(s3Proto, "send");
    try {
      send.mockRejectedValueOnce(Object.assign(new Error("nf"), { name: "NotFound", $metadata: { httpStatusCode: 404 } }));
      expect(await objectStorageService.headObject("chargeback-evidence", "abc")).toBe(false);
      send.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
      const err = await objectStorageService.headObject("chargeback-evidence", "abc").then(() => null, (e: unknown) => e);
      expect((err as StorageError).code).toBe("STORAGE_ACCESS_DENIED");
      // The declared test bucket is namespaced by the test database.
      const key = (send.mock.calls[0]?.[0] as { input?: { Key?: string } })?.input?.Key;
      expect(key).toMatch(/^test\/homigo_test[^/]*\/chargeback-evidence\/abc$/);
    } finally {
      send.mockRestore();
    }
  });

  it("an S3 timeout on put surfaces as STORAGE_UNAVAILABLE, never the raw SDK error", async () => {
    process.env.HOMIGO_REQUIRE_S3 = "1";
    process.env.AWS_S3_BUCKET = "homigo-e2e";
    process.env.AWS_S3_BUCKET_ENVIRONMENT = "test";
    const send = spyOn(s3Proto, "send").mockRejectedValue(Object.assign(new Error("socket hang up"), { name: "TimeoutError" }));
    try {
      const err = await objectStorageService
        .putObject("chargeback-evidence", Buffer.from("x"), { fileName: "e.pdf", mimeType: "application/pdf" })
        .then(() => null, (e: unknown) => e);
      expect((err as StorageError).code).toBe("STORAGE_UNAVAILABLE");
    } finally {
      send.mockRestore();
    }
  });

  it("malformed keys are refused, not rewritten", () => {
    for (const bad of ["", " ", ".", "..", "../etc/passwd", "a/../b", "/abs", "a//b", "a/", " a", "a\\b", "x\0y", "k".repeat(513)]) {
      expect(codeOf(() => objectStorageService.resolveLocalPath("chargeback-evidence", bad))).toBe("STORAGE_INVALID_KEY");
    }
  });

  it("hierarchical keys keep owners apart (no more basename flattening)", async () => {
    const a = await objectStorageService.putObject("support-attachments", Buffer.from("owner A bytes"), {
      fileName: "a.jpg",
      mimeType: "image/jpeg",
      storageKey: "vision/ownerA-guardtest/samehash",
    });
    const b = await objectStorageService.putObject("support-attachments", Buffer.from("owner B bytes"), {
      fileName: "b.jpg",
      mimeType: "image/jpeg",
      storageKey: "vision/ownerB-guardtest/samehash",
    });
    try {
      expect(objectStorageService.resolveLocalPath("support-attachments", a.storageKey)).not.toBe(
        objectStorageService.resolveLocalPath("support-attachments", b.storageKey),
      );
      await objectStorageService.deleteObject("support-attachments", a.storageKey);
      // Deleting A's image must not take B's with it.
      expect((await objectStorageService.getObjectBuffer("support-attachments", b.storageKey)).toString()).toBe("owner B bytes");
    } finally {
      await objectStorageService.deleteObject("support-attachments", a.storageKey);
      await objectStorageService.deleteObject("support-attachments", b.storageKey);
    }
  });

  it("objects written under the old flattened layout stay readable, and are never deleted on one owner's behalf", async () => {
    // Pre-fix writes landed at <namespace>/<basename>.
    const legacy = await objectStorageService.putObject("support-attachments", Buffer.from("legacy bytes"), {
      fileName: "l.jpg",
      mimeType: "image/jpeg",
      storageKey: "legacyhash-guardtest",
    });
    try {
      const key = "vision/someOwner-guardtest/legacyhash-guardtest";
      expect(await objectStorageService.headObject("support-attachments", key)).toBe(true);
      expect((await objectStorageService.getObjectBuffer("support-attachments", key)).toString()).toBe("legacy bytes");
      await objectStorageService.deleteObject("support-attachments", key);
      expect((await objectStorageService.getObjectBuffer("support-attachments", legacy.storageKey)).toString()).toBe("legacy bytes");
    } finally {
      await objectStorageService.deleteObject("support-attachments", legacy.storageKey);
    }
  });

  it("local adapter round trip; a missing object is a typed 404", async () => {
    const stored = await objectStorageService.putObject("chargeback-evidence", Buffer.from("%PDF-1.4 test"), {
      fileName: "e.pdf",
      mimeType: "application/pdf",
    });
    try {
      expect(stored.backend).toBe("local");
      expect((await objectStorageService.getObjectBuffer("chargeback-evidence", stored.storageKey)).toString()).toBe("%PDF-1.4 test");
      expect(await objectStorageService.headObject("chargeback-evidence", stored.storageKey)).toBe(true);
    } finally {
      await objectStorageService.deleteObject("chargeback-evidence", stored.storageKey);
    }
    const err = await objectStorageService.getObjectBuffer("chargeback-evidence", stored.storageKey).then(() => null, (e: unknown) => e);
    expect((err as StorageError).code).toBe("STORAGE_OBJECT_NOT_FOUND");
  });
});
