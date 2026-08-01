import crypto from "crypto";
import type { EncryptionKey, EncryptionKeyStatus, KeyPurpose } from "@prisma/client";
import { logger } from "../lib/logger";

async function getPrisma() {
  const { default: prisma } = await import("../lib/prisma-base");
  return prisma;
}
import {
  generateDataKey,
  unwrapDataKey,
  wrapDataKey,
} from "../lib/pii-crypto";

const BOOTSTRAP_PURPOSES: KeyPurpose[] = ["EMAIL", "PHONE", "PII", "PAYMENT"];

export class KeyManagementService {
  async bootstrap(): Promise<void> {
    const prisma = await getPrisma();
    for (const purpose of BOOTSTRAP_PURPOSES) {
      const active = await prisma.encryptionKey.findFirst({
        where: { purpose, status: "ACTIVE" },
      });
      if (!active) {
        await this.createKey(purpose, "SYSTEM");
        logger.info("encryption_key_bootstrapped", { purpose });
      }
    }
  }

  async createKey(purpose: KeyPurpose, createdBy: string): Promise<EncryptionKey> {
    const prisma = await getPrisma();
    const latest = await prisma.encryptionKey.findFirst({
      where: { purpose },
      orderBy: { keyVersion: "desc" },
    });
    const keyVersion = (latest?.keyVersion ?? 0) + 1;
    const dek = generateDataKey();
    const wrapped = wrapDataKey(dek);

    return prisma.encryptionKey.create({
      data: {
        keyId: crypto.randomUUID(),
        keyVersion,
        encryptedKey: wrapped.encryptedKey,
        iv: wrapped.iv,
        keyWrapAuthTag: wrapped.keyWrapAuthTag,
        status: "ACTIVE",
        purpose,
        createdBy,
      },
    });
  }

  async getActiveKey(purpose: KeyPurpose): Promise<EncryptionKey> {
    const prisma = await getPrisma();
    const key = await prisma.encryptionKey.findFirst({
      where: { purpose, status: "ACTIVE" },
      orderBy: { keyVersion: "desc" },
    });
    if (!key) {
      return this.createKey(purpose, "SYSTEM");
    }
    return key;
  }

  async getKeyByVersion(purpose: KeyPurpose, keyVersion: number): Promise<EncryptionKey | null> {
    const prisma = await getPrisma();
    return prisma.encryptionKey.findFirst({
      where: { purpose, keyVersion, status: { in: ["ACTIVE", "ROTATED"] } },
    });
  }

  async resolveDataKey(purpose: KeyPurpose, keyVersion: number): Promise<Buffer> {
    const record = await this.getKeyByVersion(purpose, keyVersion);
    if (!record) {
      throw new Error(`Encryption key not found: purpose=${purpose} version=${keyVersion}`);
    }
    return unwrapDataKey(record.encryptedKey, record.iv, record.keyWrapAuthTag);
  }

  async touchKeyUsage(keyId: string): Promise<void> {
    const prisma = await getPrisma();
    await prisma.encryptionKey.update({
      where: { id: keyId },
      data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
    });
  }

  async rotateKey(purpose: KeyPurpose, rotatedBy = "SYSTEM"): Promise<EncryptionKey> {
    const prisma = await getPrisma();
    const current = await prisma.encryptionKey.findFirst({
      where: { purpose, status: "ACTIVE" },
      orderBy: { keyVersion: "desc" },
    });

    if (current) {
      await prisma.encryptionKey.update({
        where: { id: current.id },
        data: { status: "ROTATED" as EncryptionKeyStatus, rotatedAt: new Date() },
      });
    }

    const next = await this.createKey(purpose, rotatedBy);
    logger.info("encryption_key_rotated", {
      purpose,
      previousVersion: current?.keyVersion ?? 0,
      newVersion: next.keyVersion,
    });
    return next;
  }

  async retireKey(purpose: KeyPurpose, keyVersion: number): Promise<void> {
    const prisma = await getPrisma();
    await prisma.encryptionKey.updateMany({
      where: { purpose, keyVersion },
      data: { status: "RETIRED", retiredAt: new Date() },
    });
  }

  async listKeys(purpose?: KeyPurpose) {
    const prisma = await getPrisma();
    return prisma.encryptionKey.findMany({
      where: purpose ? { purpose } : undefined,
      orderBy: [{ purpose: "asc" }, { keyVersion: "desc" }],
    });
  }
}

export const keyManagementService = new KeyManagementService();
