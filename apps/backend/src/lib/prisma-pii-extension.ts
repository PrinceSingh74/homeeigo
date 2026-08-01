import { Prisma } from "@prisma/client";
import { normalizeEmail, normalizePhone } from "./pii-normalize";
import { encryptionService } from "../services/encryption.service";

type UserWriteData = Prisma.UserCreateInput | Prisma.UserUpdateInput;

async function applyPiiEncryption(data: UserWriteData, userId?: string): Promise<void> {
  const email = "email" in data && typeof data.email === "string" ? data.email : undefined;
  const phone =
    "phoneNumber" in data && typeof data.phoneNumber === "string" ? data.phoneNumber : undefined;

  if (email) {
    const emailNorm = normalizeEmail(email);
    const emailEnc = await encryptionService.encrypt(emailNorm, "EMAIL", userId);
    data.email = null;
    data.emailEncrypted = emailEnc.ciphertext;
    data.emailHash = emailEnc.lookupHash;
    data.emailEncryptionKeyVersion = emailEnc.keyVersion;
  }

  if (phone) {
    const phoneNorm = normalizePhone(phone);
    const phoneEnc = await encryptionService.encrypt(phoneNorm, "PHONE", userId);
    data.phoneNumber = null;
    data.phoneEncrypted = phoneEnc.ciphertext;
    data.phoneHash = phoneEnc.lookupHash;
    data.phoneEncryptionKeyVersion = phoneEnc.keyVersion;
  }

  if (email || phone) {
    data.dataEncryptionStatus = "ENCRYPTED";
    data.dataEncryptedAt = new Date();
  }
}

/**
 * Prisma Client extension — encrypts email/phone on User writes.
 * Reads are decrypted explicitly via userPiiService (not auto-decrypted).
 */
export function prismaPiiExtension() {
  return Prisma.defineExtension({
    name: "pii-encryption",
    query: {
      user: {
        async create({ args, query }) {
          if (args.data) {
            await applyPiiEncryption(args.data);
          }
          return query(args);
        },
        async update({ args, query }) {
          if (args.data) {
            const userId = typeof args.where.id === "string" ? args.where.id : undefined;
            await applyPiiEncryption(args.data, userId);
          }
          return query(args);
        },
        async upsert({ args, query }) {
          if (args.create) await applyPiiEncryption(args.create);
          if (args.update) await applyPiiEncryption(args.update);
          return query(args);
        },
      },
    },
  });
}
