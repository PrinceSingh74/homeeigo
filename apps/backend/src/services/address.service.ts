import prisma from "../lib/prisma";
import { formatAddress } from "../lib/format";
import { sanitizeUserInput } from "../utils/sanitizer";
import { addressPiiService } from "./address-pii.service";

function sanitizeAddressInput(data: {
  label: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zipCode: string;
  landmark?: string;
  specialInstructions?: string;
}) {
  return {
    label: sanitizeUserInput(data.label, 50),
    addressLine1: sanitizeUserInput(data.addressLine1, 200),
    addressLine2: data.addressLine2 ? sanitizeUserInput(data.addressLine2, 200) : undefined,
    city: sanitizeUserInput(data.city, 100),
    state: sanitizeUserInput(data.state, 100),
    zipCode: sanitizeUserInput(data.zipCode, 10),
    landmark: data.landmark ? sanitizeUserInput(data.landmark, 200) : undefined,
    specialInstructions: data.specialInstructions
      ? sanitizeUserInput(data.specialInstructions, 500)
      : undefined,
  };
}

function buildFullAddress(parts: {
  addressLine1: string;
  addressLine2?: string | null;
  city: string;
  state: string;
  zipCode: string;
}) {
  const line2 = parts.addressLine2 ? `, ${parts.addressLine2}` : "";
  return `${parts.addressLine1}${line2}, ${parts.city}, ${parts.state} ${parts.zipCode}`;
}

export class AddressService {
  async list(userId: string) {
    const rows = await prisma.address.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
    const decrypted = await Promise.all(rows.map((r) => addressPiiService.withDecrypted(r)));
    return decrypted.map(formatAddress);
  }

  async create(
    userId: string,
    data: {
      label: string;
      addressLine1: string;
      addressLine2?: string;
      city: string;
      state: string;
      zipCode: string;
      latitude: number;
      longitude: number;
      landmark?: string;
      specialInstructions?: string;
    },
  ) {
    const count = await prisma.address.count({ where: { userId } });
    const safe = sanitizeAddressInput(data);
    const fullAddress = buildFullAddress(safe);
    const encrypted = await addressPiiService.buildEncryptedCreateFields(
      {
        addressLine1: safe.addressLine1,
        addressLine2: safe.addressLine2,
        fullAddress,
        landmark: safe.landmark,
        specialInstructions: safe.specialInstructions,
      },
      userId,
    );

    const address = await prisma.address.create({
      data: {
        userId,
        label: safe.label,
        city: safe.city,
        state: safe.state,
        zipCode: safe.zipCode,
        latitude: data.latitude,
        longitude: data.longitude,
        landmark: null,
        specialInstructions: null,
        isDefault: count === 0,
        ...encrypted,
      } as Parameters<typeof prisma.address.create>[0]["data"],
    });
    if (count === 0) {
      await prisma.user.update({ where: { id: userId }, data: { defaultAddressId: address.id } });
    }
    return formatAddress(await addressPiiService.withDecrypted(address));
  }

  async update(userId: string, id: string, patch: Record<string, unknown>) {
    const existing = await prisma.address.findFirst({ where: { id, userId } });
    if (!existing) return null;

    const textKeys = [
      "label",
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "zipCode",
      "landmark",
      "specialInstructions",
    ] as const;
    const sanitizedPatch: Record<string, unknown> = { ...patch };
    for (const key of textKeys) {
      if (typeof sanitizedPatch[key] === "string") {
        const maxLen = key === "specialInstructions" ? 500 : key === "zipCode" ? 10 : 200;
        sanitizedPatch[key] = sanitizeUserInput(sanitizedPatch[key] as string, maxLen);
      }
    }

    const decryptedExisting = await addressPiiService.withDecrypted(existing);
    const merged = { ...decryptedExisting, ...sanitizedPatch } as typeof decryptedExisting;
    const fullAddress = buildFullAddress(merged);

    const encryptedPatch = await addressPiiService.buildEncryptedUpdateFields(
      {
        addressLine1: merged.addressLine1,
        addressLine2: merged.addressLine2,
        fullAddress,
        landmark: merged.landmark,
        specialInstructions: merged.specialInstructions,
      },
      existing,
      userId,
    );

    const { addressLine1: _a1, addressLine2: _a2, fullAddress: _fa, landmark: _lm, specialInstructions: _si, ...geoPatch } =
      sanitizedPatch;

    const updated = await prisma.address.update({
      where: { id },
      data: { ...geoPatch, ...encryptedPatch } as Parameters<typeof prisma.address.update>[0]["data"],
    });
    return formatAddress(await addressPiiService.withDecrypted(updated));
  }

  async remove(userId: string, id: string) {
    const count = await prisma.address.count({ where: { userId } });
    if (count <= 1) return { error: "ONLY_ADDRESS" as const };
    const addr = await prisma.address.findFirst({ where: { id, userId } });
    if (!addr) return { error: "NOT_FOUND" as const };
    await prisma.address.delete({ where: { id } });
    if (addr.isDefault) {
      const next = await prisma.address.findFirst({ where: { userId } });
      if (next) {
        await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
        await prisma.user.update({ where: { id: userId }, data: { defaultAddressId: next.id } });
      }
    }
    return { ok: true as const };
  }

  async setDefault(userId: string, id: string) {
    const addr = await prisma.address.findFirst({ where: { id, userId } });
    if (!addr) return null;
    await prisma.address.updateMany({ where: { userId }, data: { isDefault: false } });
    await prisma.address.update({ where: { id }, data: { isDefault: true } });
    await prisma.user.update({ where: { id: userId }, data: { defaultAddressId: id } });
    return true;
  }
}

export const addressService = new AddressService();
