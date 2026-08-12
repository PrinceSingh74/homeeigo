import { describe, expect, it, beforeAll } from "bun:test";
import {
  hashForLookup,
  packEncrypt,
  unpackDecrypt,
  wrapDataKey,
  unwrapDataKey,
  generateDataKey,
  integrityHash,
} from "../lib/pii-crypto";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from "../lib/pii-normalize";
import { securityEventRetention } from "../services/enterprise-audit.service";

describe("P4 Part A — encryption & PII utilities", () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.HASH_HMAC_KEY = "test-hmac-pepper-key";
    process.env.MASTER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("normalizes email and phone consistently", () => {
    expect(normalizeEmail("  User@Example.COM ")).toBe("user@example.com");
    expect(normalizePhone("9876543210")).toBe("+919876543210");
  });

  it("produces deterministic lookup hashes", () => {
    const a = hashForLookup(normalizeEmail("user@homigo.com"));
    const b = hashForLookup(normalizeEmail("user@homigo.com"));
    expect(a).toBe(b);
    expect(a).not.toBe(hashForLookup(normalizeEmail("other@homigo.com")));
  });

  it("round-trips AES-256-GCM pack encrypt/decrypt", () => {
    const key = generateDataKey();
    const packed = packEncrypt("secret@homigo.com", key, 1);
    expect(packed.token.startsWith("enc:p4:v1:")).toBe(true);
    expect(unpackDecrypt(packed.token, key)).toBe("secret@homigo.com");
  });

  it("wraps and unwraps data keys with auth tag", () => {
    const dek = generateDataKey();
    const wrapped = wrapDataKey(dek);
    const unwrapped = unwrapDataKey(wrapped.encryptedKey, wrapped.iv, wrapped.keyWrapAuthTag);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  it("masks email and phone for API responses", () => {
    expect(maskEmail("user@homigo.com")).toContain("@");
    expect(maskEmail("user@homigo.com")).not.toBe("user@homigo.com");
    expect(maskPhone("+919876543210")).not.toContain("9876543210");
  });

  it("maps security events to retention categories", () => {
    expect(securityEventRetention("LOGIN")).toBe("LOGIN_EVENTS");
    expect(securityEventRetention("PAYMENT_REFUND")).toBe("PAYMENT_EVENTS");
    expect(securityEventRetention("ADMIN_ACTION")).toBe("SECURITY_EVENTS");
  });

  it("builds stable integrity hashes", () => {
    const h1 = integrityHash(["LOGIN", "user1", "security_event", "trace-1", "SUCCESS"]);
    const h2 = integrityHash(["LOGIN", "user1", "security_event", "trace-1", "SUCCESS"]);
    expect(h1).toBe(h2);
  });
});
