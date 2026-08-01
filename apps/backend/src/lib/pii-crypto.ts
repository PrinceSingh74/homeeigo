import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PACKED_PREFIX = "enc:p4:";

export type PackedCiphertext = {
  token: string;
  keyVersion: number;
};

export function resolveHashPepper(): string {
  const pepper = process.env.HASH_HMAC_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim();
  if (pepper) return pepper;
  if (process.env.NODE_ENV === "production") {
    throw new Error("HASH_HMAC_KEY or ENCRYPTION_KEY is required in production for PII lookup hashes");
  }
  const seed = process.env.JWT_SECRET || "homigo-dev-hash-pepper";
  console.warn("[pii-crypto] HASH_HMAC_KEY not set — using insecure dev pepper");
  return seed;
}

export function resolveMasterKey(): Buffer {
  const raw = process.env.MASTER_ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_KEY?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MASTER_ENCRYPTION_KEY or ENCRYPTION_KEY is required in production");
    }
    const seed = process.env.JWT_SECRET || "homigo-dev-master-seed";
    console.warn("[pii-crypto] MASTER_ENCRYPTION_KEY not set — using insecure dev master key");
    return crypto.createHash("sha256").update(seed).digest();
  }

  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }

  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) {
    throw new Error("MASTER_ENCRYPTION_KEY must be 64 hex chars or base64-encoded 32 bytes");
  }
  return decoded;
}

/** Deterministic HMAC-SHA256 blind index for email/phone lookup. */
export function hashForLookup(normalizedValue: string): string {
  return crypto.createHmac("sha256", resolveHashPepper()).update(normalizedValue).digest("hex");
}

export function packEncrypt(plaintext: string, key: Buffer, keyVersion: number): PackedCiphertext {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return {
    token: `${PACKED_PREFIX}v${keyVersion}:${packed.toString("base64")}`,
    keyVersion,
  };
}

export function unpackDecrypt(token: string, key: Buffer): string {
  const match = /^enc:p4:v(\d+):(.+)$/.exec(token);
  if (!match) {
    throw new Error("Invalid P4 ciphertext format");
  }
  const packed = Buffer.from(match[2]!, "base64");
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function parsePackedKeyVersion(token: string): number {
  const match = /^enc:p4:v(\d+):/.exec(token);
  if (!match) throw new Error("Invalid P4 ciphertext format");
  return Number.parseInt(match[1]!, 10);
}

export function wrapDataKey(dek: Buffer): { encryptedKey: string; iv: string; keyWrapAuthTag: string } {
  const masterKey = resolveMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedKey: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    keyWrapAuthTag: authTag.toString("base64"),
  };
}

export function unwrapDataKey(encryptedKey: string, ivB64: string, authTagB64: string): Buffer {
  const masterKey = resolveMasterKey();
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const ciphertext = Buffer.from(encryptedKey, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, masterKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function generateDataKey(): Buffer {
  return crypto.randomBytes(32);
}

export function integrityHash(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join(":")).digest("hex");
}
