import type { Prisma, User } from "@prisma/client";
import prisma from "../lib/prisma";
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from "../lib/pii-normalize";
import { encryptionService } from "./encryption.service";

type UserPiiFields = Pick<User, "id" | "email" | "phoneNumber"> &
  Partial<
    Pick<
      User,
      | "emailEncrypted"
      | "phoneEncrypted"
      | "emailHash"
      | "phoneHash"
      | "emailEncryptionKeyVersion"
      | "phoneEncryptionKeyVersion"
      | "dataEncryptionStatus"
    >
  >;

export type UserCreatePiiInput = {
  email: string;
  phoneNumber: string;
  userId?: string;
};

export class UserPiiService {
  async buildEncryptedCreateFields(input: UserCreatePiiInput): Promise<Prisma.UserCreateInput> {
    const emailNorm = normalizeEmail(input.email);
    const phoneNorm = normalizePhone(input.phoneNumber);

    const [emailEnc, phoneEnc] = await Promise.all([
      encryptionService.encrypt(emailNorm, "EMAIL", input.userId),
      encryptionService.encrypt(phoneNorm, "PHONE", input.userId),
    ]);

    return {
      email: null,
      phoneNumber: null,
      emailEncrypted: emailEnc.ciphertext,
      emailHash: emailEnc.lookupHash,
      emailEncryptionKeyVersion: emailEnc.keyVersion,
      phoneEncrypted: phoneEnc.ciphertext,
      phoneHash: phoneEnc.lookupHash,
      phoneEncryptionKeyVersion: phoneEnc.keyVersion,
      dataEncryptionStatus: "ENCRYPTED",
      dataEncryptedAt: new Date(),
    } as Prisma.UserCreateInput;
  }

  async buildEncryptedUpdateFields(
    input: Partial<{ email: string; phoneNumber: string }>,
    userId?: string,
  ): Promise<Prisma.UserUpdateInput> {
    const data: Prisma.UserUpdateInput = {};

    if (input.email !== undefined) {
      const emailNorm = normalizeEmail(input.email);
      const emailEnc = await encryptionService.encrypt(emailNorm, "EMAIL", userId);
      data.email = null;
      data.emailEncrypted = emailEnc.ciphertext;
      data.emailHash = emailEnc.lookupHash;
      data.emailEncryptionKeyVersion = emailEnc.keyVersion;
    }

    if (input.phoneNumber !== undefined) {
      const phoneNorm = normalizePhone(input.phoneNumber);
      const phoneEnc = await encryptionService.encrypt(phoneNorm, "PHONE", userId);
      data.phoneNumber = null;
      data.phoneEncrypted = phoneEnc.ciphertext;
      data.phoneHash = phoneEnc.lookupHash;
      data.phoneEncryptionKeyVersion = phoneEnc.keyVersion;
    }

    if (input.email !== undefined || input.phoneNumber !== undefined) {
      data.dataEncryptionStatus = "ENCRYPTED";
      data.dataEncryptedAt = new Date();
    }

    return data;
  }

  async findByEmail(email: string) {
    const emailNorm = normalizeEmail(email);
    const hash = encryptionService.createDeterministicHash(emailNorm);
    return prisma.user.findFirst({
      where: {
        OR: [{ emailHash: hash }, { email: emailNorm }],
      },
    });
  }

  async findByPhone(phone: string) {
    const phoneNorm = normalizePhone(phone);
    const hash = encryptionService.createDeterministicHash(phoneNorm);
    return prisma.user.findFirst({
      where: {
        OR: [{ phoneHash: hash }, { phoneNumber: phoneNorm }],
      },
    });
  }

  async emailExists(email: string): Promise<boolean> {
    const user = await this.findByEmail(email);
    return Boolean(user);
  }

  async phoneExists(phone: string): Promise<boolean> {
    const user = await this.findByPhone(phone);
    return Boolean(user);
  }

  async resolveEmail(user: UserPiiFields, opts?: { actorId?: string; authorized?: boolean }): Promise<string | null> {
    if (user.email) return user.email;
    if (!user.emailEncrypted) return null;
    return encryptionService.decrypt(user.emailEncrypted, "EMAIL", {
      actorId: opts?.actorId ?? user.id,
      authorized: opts?.authorized ?? true,
    });
  }

  async resolvePhone(user: UserPiiFields, opts?: { actorId?: string; authorized?: boolean }): Promise<string | null> {
    if (user.phoneNumber) return user.phoneNumber;
    if (!user.phoneEncrypted) return null;
    return encryptionService.decrypt(user.phoneEncrypted, "PHONE", {
      actorId: opts?.actorId ?? user.id,
      authorized: opts?.authorized ?? true,
    });
  }

  async resolveEmailAndPhone(
    user: UserPiiFields,
    opts?: { actorId?: string; authorized?: boolean },
  ): Promise<{ email: string | null; phoneNumber: string | null }> {
    const [email, phoneNumber] = await Promise.all([
      this.resolveEmail(user, opts),
      this.resolvePhone(user, opts),
    ]);
    return { email, phoneNumber };
  }

  maskUserPii(user: { email?: string | null; phoneNumber?: string | null }) {
    return {
      email: user.email ? maskEmail(user.email) : null,
      phoneNumber: user.phoneNumber ? maskPhone(user.phoneNumber) : null,
    };
  }

  async withDecryptedPii<T extends UserPiiFields>(
    user: T,
    opts?: { actorId?: string; authorized?: boolean },
  ): Promise<T & { email: string | null; phoneNumber: string | null }> {
    const resolved = await this.resolveEmailAndPhone(user, opts);
    return { ...user, ...resolved };
  }

  async withMaskedPii<T extends UserPiiFields>(user: T) {
    const resolved = await this.resolveEmailAndPhone(user, { authorized: true });
    return {
      ...user,
      email: resolved.email ? maskEmail(resolved.email) : null,
      phoneNumber: resolved.phoneNumber ? maskPhone(resolved.phoneNumber) : null,
    };
  }

  hashEmail(email: string): string {
    return encryptionService.createDeterministicHash(normalizeEmail(email));
  }

  hashPhone(phone: string): string {
    return encryptionService.createDeterministicHash(normalizePhone(phone));
  }
}

export const userPiiService = new UserPiiService();
