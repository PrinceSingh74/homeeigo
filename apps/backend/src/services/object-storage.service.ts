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
import { generateStorageKey } from "../lib/storage-key";
import { logger } from "../lib/logger";

export type StorageNamespace =
  | "chargeback-evidence"
  | "compliance-exports"
  | "support-attachments"
  | "admin-uploads";

const LOCAL_ROOT = process.env.LOCAL_UPLOAD_ROOT || path.join(process.cwd(), "uploads");
const SIGNED_URL_TTL_SEC = Number(process.env.S3_SIGNED_URL_TTL_SEC ?? 300);

function bucket(): string | null {
  const b = process.env.AWS_S3_BUCKET?.trim();
  return b || null;
}

function region(): string {
  return process.env.AWS_REGION || "ap-south-1";
}

function s3Client(): S3Client {
  return new S3Client({ region: region() });
}

function objectKey(namespace: StorageNamespace, storageKey: string): string {
  const safe = path.basename(storageKey);
  return `${namespace}/${safe}`;
}

function localPath(namespace: StorageNamespace, storageKey: string): string {
  const safe = path.basename(storageKey);
  const dir = path.join(LOCAL_ROOT, namespace);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, safe);
  if (!filePath.startsWith(dir)) throw new Error("INVALID_PATH");
  return filePath;
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
  isS3Enabled(): boolean {
    return Boolean(bucket());
  }

  async putObject(
    namespace: StorageNamespace,
    body: Buffer,
    opts: { fileName: string; mimeType: string; storageKey?: string },
  ): Promise<StoredObject> {
    const storageKey = opts.storageKey ?? generateStorageKey();
    const fileHash = crypto.createHash("sha256").update(body).digest("hex");
    const key = objectKey(namespace, storageKey);
    const b = bucket();

    if (b) {
      await s3Client().send(
        new PutObjectCommand({
          Bucket: b,
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
      return {
        storageKey,
        fileUrl: `s3://${b}/${key}`,
        fileSize: body.length,
        fileHash,
        backend: "s3",
        mimeType: opts.mimeType,
      };
    }

    const filePath = localPath(namespace, storageKey);
    fs.writeFileSync(filePath, body);
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
    const b = bucket();
    if (b) {
      const res = await s3Client().send(
        new GetObjectCommand({ Bucket: b, Key: objectKey(namespace, storageKey) }),
      );
      const chunks: Uint8Array[] = [];
      const stream = res.Body;
      if (!stream || typeof stream === "string") throw new Error("NOT_FOUND");
      for await (const chunk of stream as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    }

    const filePath = localPath(namespace, storageKey);
    if (!fs.existsSync(filePath)) throw new Error("NOT_FOUND");
    return fs.readFileSync(filePath);
  }

  async deleteObject(namespace: StorageNamespace, storageKey: string): Promise<void> {
    const b = bucket();
    if (b) {
      await s3Client().send(
        new DeleteObjectCommand({ Bucket: b, Key: objectKey(namespace, storageKey) }),
      );
      return;
    }
    const filePath = localPath(namespace, storageKey);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  async headObject(namespace: StorageNamespace, storageKey: string): Promise<boolean> {
    const b = bucket();
    if (b) {
      try {
        await s3Client().send(
          new HeadObjectCommand({ Bucket: b, Key: objectKey(namespace, storageKey) }),
        );
        return true;
      } catch {
        return false;
      }
    }
    return fs.existsSync(localPath(namespace, storageKey));
  }

  async createSignedDownloadUrl(
    namespace: StorageNamespace,
    storageKey: string,
    ttlSec = SIGNED_URL_TTL_SEC,
  ): Promise<string> {
    const b = bucket();
    if (!b) throw new Error("S3_NOT_CONFIGURED");
    return getSignedUrl(
      s3Client(),
      new GetObjectCommand({ Bucket: b, Key: objectKey(namespace, storageKey) }),
      { expiresIn: ttlSec },
    );
  }

  resolveLocalPath(namespace: StorageNamespace, storageKey: string): string {
    return localPath(namespace, storageKey);
  }
}

export const objectStorageService = new ObjectStorageService();
