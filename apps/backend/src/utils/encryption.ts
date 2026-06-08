import crypto from "crypto";

/**
 * Part 5 — Encryption for sensitive data at rest (PII, bank details, etc.).
 *
 * Uses AES-256-GCM (authenticated encryption). The 256-bit key comes from
 * `ENCRYPTION_KEY` (64 hex chars). In non-production, if the key is missing we
 * derive a deterministic dev-only key from `JWT_SECRET` and warn loudly so the
 * app still boots; in production a missing/invalid key throws.
 *
 * Wire format (base64):  [12-byte IV][16-byte auth tag][ciphertext]
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM recommended nonce size
const AUTH_TAG_LENGTH = 16;
const ENCRYPTED_PREFIX = "enc:v1:";

function resolveKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY?.trim();

  if (raw) {
    if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
      throw new Error("ENCRYPTION_KEY must be 64 hex characters (256 bits). Generate with: openssl rand -hex 32");
    }
    return Buffer.from(raw, "hex");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("ENCRYPTION_KEY is required in production. Generate with: openssl rand -hex 32");
  }

  // Dev fallback: deterministic key so encrypt/decrypt round-trips across restarts.
  const seed = process.env.JWT_SECRET || "homigo-dev-encryption-seed";
  console.warn(
    "[encryption] ENCRYPTION_KEY not set — using an insecure dev-only derived key. Set ENCRYPTION_KEY before production.",
  );
  return crypto.createHash("sha256").update(seed).digest();
}

export class EncryptionService {
  private readonly key: Buffer;

  constructor(key?: Buffer) {
    this.key = key ?? resolveKey();
  }

  /** Encrypt a UTF-8 string. Returns a prefixed base64 token. */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const packed = Buffer.concat([iv, authTag, encrypted]);
    return ENCRYPTED_PREFIX + packed.toString("base64");
  }

  /** Decrypt a token produced by `encrypt`. Throws if tampered or malformed. */
  decrypt(token: string): string {
    if (!token.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error("Invalid ciphertext: missing version prefix");
    }
    const packed = Buffer.from(token.slice(ENCRYPTED_PREFIX.length), "base64");
    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const encrypted = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }

  /** True if the value looks like it was produced by `encrypt`. */
  isEncrypted(value: string): boolean {
    return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
  }

  /** Encrypt only if not already encrypted (safe for idempotent migrations). */
  encryptIfNeeded(value: string): string {
    return this.isEncrypted(value) ? value : this.encrypt(value);
  }

  /** One-way deterministic hash (e.g. for blind-indexing / lookup of PII). */
  static hashForLookup(value: string): string {
    const pepper = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "homigo";
    return crypto.createHmac("sha256", pepper).update(value.trim().toLowerCase()).digest("hex");
  }
}

let singleton: EncryptionService | null = null;

/** Lazily-initialised shared instance (defers key validation until first use). */
export function getEncryptionService(): EncryptionService {
  if (!singleton) singleton = new EncryptionService();
  return singleton;
}
