import type { Provider, User, Withdrawal } from "@prisma/client";
import { getEncryptionService, EncryptionService } from "../utils/encryption";
import prisma from "../lib/prisma";

/**
 * Encrypts PII at rest and supports blind-index uniqueness checks via `*Hash` columns.
 * Legacy plaintext rows are still readable until re-saved.
 */

const enc = () => getEncryptionService();

export function decryptValue(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (enc().isEncrypted(value)) return enc().decrypt(value);
  return value;
}

export function maskValue(value: string | null | undefined, visibleEnd = 4): string | null {
  const plain = decryptValue(value);
  if (!plain) return null;
  if (plain.length <= visibleEnd) return "****";
  return `${"*".repeat(Math.min(plain.length - visibleEnd, 8))}${plain.slice(-visibleEnd)}`;
}

type ProviderKycInput = {
  panNumber?: string | null;
  aadharNumber?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolder?: string | null;
  bankIfscCode?: string | null;
  bankName?: string | null;
  taxId?: string | null;
  upiId?: string | null;
};

function normalizePan(pan: string): string {
  return pan.trim().toUpperCase();
}

function normalizeAadhar(aadhar: string): string {
  return aadhar.replace(/\D/g, "");
}

function normalizeBankAccount(num: string): string {
  return num.replace(/\s/g, "");
}

function normalizeIfsc(ifsc: string): string {
  return ifsc.trim().toUpperCase();
}

/** Build Prisma `data` with encrypted values + lookup hashes for Provider KYC/bank fields. */
export function encryptProviderKycFields(input: ProviderKycInput): Record<string, string | null> {
  const data: Record<string, string | null> = {};

  if (input.panNumber) {
    const norm = normalizePan(input.panNumber);
    data.panNumber = enc().encrypt(norm);
    data.panNumberHash = EncryptionService.hashForLookup(norm);
  }
  if (input.aadharNumber) {
    const norm = normalizeAadhar(input.aadharNumber);
    data.aadharNumber = enc().encrypt(norm);
    data.aadharNumberHash = EncryptionService.hashForLookup(norm);
  }
  if (input.bankAccountNumber) {
    const norm = normalizeBankAccount(input.bankAccountNumber);
    data.bankAccountNumber = enc().encrypt(norm);
    data.bankAccountNumberHash = EncryptionService.hashForLookup(norm);
  }
  if (input.bankAccountHolder) {
    data.bankAccountHolder = enc().encrypt(input.bankAccountHolder.trim());
  }
  if (input.bankIfscCode) {
    const norm = normalizeIfsc(input.bankIfscCode);
    data.bankIfscCode = enc().encrypt(norm);
  }
  if (input.bankName) {
    data.bankName = enc().encrypt(input.bankName.trim());
  }
  if (input.taxId) {
    const norm = input.taxId.trim().toUpperCase();
    data.taxId = enc().encrypt(norm);
    data.taxIdHash = EncryptionService.hashForLookup(norm);
  }
  if (input.upiId) {
    const norm = input.upiId.trim().toLowerCase();
    data.upiId = enc().encrypt(norm);
    data.upiIdHash = EncryptionService.hashForLookup(norm);
  }

  return data;
}

export async function assertProviderKycUnique(
  providerId: string,
  input: ProviderKycInput,
): Promise<void> {
  const checks: Array<{ hash: string; field: keyof ProviderKycInput; label: string }> = [];

  if (input.panNumber) {
    checks.push({
      hash: EncryptionService.hashForLookup(normalizePan(input.panNumber)),
      field: "panNumber",
      label: "PAN",
    });
  }
  if (input.aadharNumber) {
    checks.push({
      hash: EncryptionService.hashForLookup(normalizeAadhar(input.aadharNumber)),
      field: "aadharNumber",
      label: "Aadhaar",
    });
  }
  if (input.bankAccountNumber) {
    checks.push({
      hash: EncryptionService.hashForLookup(normalizeBankAccount(input.bankAccountNumber)),
      field: "bankAccountNumber",
      label: "Bank account",
    });
  }

  for (const { hash, label } of checks) {
    const hashField =
      label === "PAN"
        ? "panNumberHash"
        : label === "Aadhaar"
          ? "aadharNumberHash"
          : "bankAccountNumberHash";

    const existing = await prisma.provider.findFirst({
      where: {
        id: { not: providerId },
        [hashField]: hash,
      },
      select: { id: true },
    });
    if (existing) {
      throw new Error(`CONFLICT:${label} is already registered`);
    }
  }
}

export function encryptUserKycDocumentNumber(documentNumber: string): {
  kycDocumentNumber: string;
  kycDocumentNumberHash: string;
} {
  const norm = documentNumber.trim().toUpperCase();
  return {
    kycDocumentNumber: enc().encrypt(norm),
    kycDocumentNumberHash: EncryptionService.hashForLookup(norm),
  };
}

export function encryptWithdrawalBankFields(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
}): Pick<Withdrawal, "accountNumber" | "ifscCode" | "accountHolderName" | "bankName"> {
  return {
    accountNumber: enc().encrypt(normalizeBankAccount(input.accountNumber)),
    ifscCode: enc().encrypt(normalizeIfsc(input.ifscCode)),
    accountHolderName: enc().encrypt(input.accountHolderName.trim()),
    bankName: enc().encrypt(input.bankName.trim()),
  };
}

export function decryptWithdrawalBankFields(input: {
  accountNumber: string;
  ifscCode: string;
  accountHolderName: string;
  bankName: string;
}) {
  return {
    accountNumber: decryptValue(input.accountNumber) ?? input.accountNumber,
    ifscCode: decryptValue(input.ifscCode) ?? input.ifscCode,
    accountHolderName: decryptValue(input.accountHolderName) ?? input.accountHolderName,
    bankName: decryptValue(input.bankName) ?? input.bankName,
  };
}

/** Mask provider bank/KYC fields for API responses (partner + admin list views). */
export function maskProviderSensitive<T extends ProviderKycInput>(provider: T): T {
  return {
    ...provider,
    panNumber: maskValue(provider.panNumber ?? null),
    aadharNumber: maskValue(provider.aadharNumber ?? null, 4),
    bankAccountNumber: maskValue(provider.bankAccountNumber ?? null, 4),
    bankAccountHolder: provider.bankAccountHolder
      ? maskValue(provider.bankAccountHolder, 0)?.replace(/./g, "*") ?? null
      : provider.bankAccountHolder,
    bankIfscCode: provider.bankIfscCode ? maskValue(provider.bankIfscCode, 4) : provider.bankIfscCode,
    bankName: provider.bankName,
    taxId: maskValue(provider.taxId ?? null, 4),
    upiId: maskValue(provider.upiId ?? null, 4),
  };
}

/** Full decrypt for trusted admin review only. */
export function decryptProviderForAdmin(provider: Provider): Provider {
  return {
    ...provider,
    panNumber: decryptValue(provider.panNumber),
    aadharNumber: decryptValue(provider.aadharNumber),
    bankAccountNumber: decryptValue(provider.bankAccountNumber),
    bankAccountHolder: decryptValue(provider.bankAccountHolder),
    bankIfscCode: decryptValue(provider.bankIfscCode),
    bankName: decryptValue(provider.bankName),
    taxId: decryptValue(provider.taxId),
    upiId: decryptValue(provider.upiId),
  };
}

export function decryptUserKyc(user: Pick<User, "kycDocumentNumber">): string | null {
  return decryptValue(user.kycDocumentNumber);
}

export function encryptDocumentNumber(documentNumber: string): string {
  const norm = documentNumber.trim();
  return enc().encrypt(norm);
}
