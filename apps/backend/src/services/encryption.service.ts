import type { KeyPurpose } from "@prisma/client";
import { logger } from "../lib/logger";
import {
  hashForLookup,
  packEncrypt,
  parsePackedKeyVersion,
  unpackDecrypt,
} from "../lib/pii-crypto";
import { keyManagementService } from "./key-management.service";
import { enterpriseAuditService } from "./enterprise-audit.service";

export type PiiPurpose = Extract<KeyPurpose, "EMAIL" | "PHONE" | "PII" | "PAYMENT">;

export type EncryptedField = {
  ciphertext: string;
  keyVersion: number;
  lookupHash: string;
};

export class EncryptionService {
  async encrypt(plaintext: string, purpose: PiiPurpose, actorId?: string): Promise<EncryptedField> {
    try {
      const keyRecord = await keyManagementService.getActiveKey(purpose);
      const dek = await keyManagementService.resolveDataKey(purpose, keyRecord.keyVersion);
      const packed = packEncrypt(plaintext, dek, keyRecord.keyVersion);

      await keyManagementService.touchKeyUsage(keyRecord.id);

      void enterpriseAuditService.recordSystemEvent({
        action: "DATA_ENCRYPTED",
        resource: "encryption",
        actor: actorId,
        status: "SUCCESS",
        changesSummary: `Encrypted ${purpose} with key v${keyRecord.keyVersion}`,
        retentionCategory: "SECURITY_EVENTS",
      });

      return {
        ciphertext: packed.token,
        keyVersion: packed.keyVersion,
        lookupHash: hashForLookup(plaintext),
      };
    } catch (err) {
      logger.error("encryption_failed", {
        purpose,
        error: err instanceof Error ? err.message : String(err),
      });
      void enterpriseAuditService.recordSystemEvent({
        action: "DATA_ENCRYPTED",
        resource: "encryption",
        actor: actorId,
        status: "FAILURE",
        errorMessage: err instanceof Error ? err.message : String(err),
        retentionCategory: "SECURITY_EVENTS",
      });
      throw err;
    }
  }

  async decrypt(
    ciphertext: string,
    purpose: PiiPurpose,
    opts?: { actorId?: string; authorized?: boolean },
  ): Promise<string> {
    if (opts?.authorized === false) {
      throw new Error("Unauthorized to decrypt this data");
    }

    try {
      const keyVersion = parsePackedKeyVersion(ciphertext);
      const dek = await keyManagementService.resolveDataKey(purpose, keyVersion);
      const plaintext = unpackDecrypt(ciphertext, dek);

      void enterpriseAuditService.recordSystemEvent({
        action: "DATA_DECRYPTED",
        resource: "encryption",
        actor: opts?.actorId,
        status: "SUCCESS",
        changesSummary: `Decrypted ${purpose} with key v${keyVersion}`,
        retentionCategory: "SECURITY_EVENTS",
      });

      return plaintext;
    } catch (err) {
      logger.error("decryption_failed", {
        purpose,
        error: err instanceof Error ? err.message : String(err),
      });
      void enterpriseAuditService.recordSystemEvent({
        action: "DATA_DECRYPTED",
        resource: "encryption",
        actor: opts?.actorId,
        status: "FAILURE",
        errorMessage: err instanceof Error ? err.message : String(err),
        retentionCategory: "SECURITY_EVENTS",
      });
      throw err;
    }
  }

  createDeterministicHash(normalizedValue: string): string {
    return hashForLookup(normalizedValue);
  }

  async rotateKey(purpose: PiiPurpose, rotatedBy = "SYSTEM") {
    return keyManagementService.rotateKey(purpose, rotatedBy);
  }
}

export const encryptionService = new EncryptionService();
