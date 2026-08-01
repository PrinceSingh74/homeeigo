import prisma from "../lib/prisma";
import type { SavedPaymentMethodType } from "@prisma/client";

const MAX_METHODS_PER_USER = 10;
const UPI_HANDLE_RE = /^[a-zA-Z0-9._-]{2,64}@[a-zA-Z]{2,32}$/;
const LAST4_RE = /^\d{4}$/;

export type AddPaymentMethodInput = {
  type: SavedPaymentMethodType;
  label: string;
  last4?: string;
  network?: string;
  upiHandle?: string;
  setDefault?: boolean;
};

function serialize(method: {
  id: string;
  type: SavedPaymentMethodType;
  label: string;
  last4: string | null;
  network: string | null;
  upiHandle: string | null;
  isDefault: boolean;
  createdAt: Date;
}) {
  return {
    id: method.id,
    type: method.type.toLowerCase() as "card" | "upi" | "bank",
    label: method.label,
    last4: method.last4,
    network: method.network,
    upiHandle: method.upiHandle,
    isDefault: method.isDefault,
    createdAt: method.createdAt,
  };
}

export const paymentMethodService = {
  async list(userId: string) {
    const methods = await prisma.savedPaymentMethod.findMany({
      where: { userId },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });
    return { methods: methods.map(serialize) };
  },

  async add(userId: string, input: AddPaymentMethodInput) {
    const label = input.label.trim();
    if (!label || label.length > 50) return { error: "INVALID_LABEL" as const };
    if (input.type === "UPI") {
      if (!input.upiHandle || !UPI_HANDLE_RE.test(input.upiHandle.trim())) {
        return { error: "INVALID_UPI_HANDLE" as const };
      }
    }
    if (input.type === "CARD" && input.last4 && !LAST4_RE.test(input.last4)) {
      return { error: "INVALID_LAST4" as const };
    }

    const count = await prisma.savedPaymentMethod.count({ where: { userId } });
    if (count >= MAX_METHODS_PER_USER) return { error: "LIMIT_REACHED" as const };

    const upiHandle = input.type === "UPI" ? input.upiHandle?.trim() : undefined;
    if (upiHandle) {
      const duplicate = await prisma.savedPaymentMethod.findFirst({
        where: { userId, upiHandle },
      });
      if (duplicate) return { error: "DUPLICATE_METHOD" as const };
    }

    const makeDefault = input.setDefault === true || count === 0;
    const method = await prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.savedPaymentMethod.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return tx.savedPaymentMethod.create({
        data: {
          userId,
          type: input.type,
          label,
          last4: input.type === "CARD" ? (input.last4 ?? null) : null,
          network: input.type === "CARD" ? (input.network?.trim() || null) : null,
          upiHandle: upiHandle ?? null,
          isDefault: makeDefault,
        },
      });
    });
    return { method: serialize(method) };
  },

  async remove(userId: string, methodId: string) {
    const method = await prisma.savedPaymentMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) return { error: "NOT_FOUND" as const };

    await prisma.$transaction(async (tx) => {
      await tx.savedPaymentMethod.delete({ where: { id: method.id } });
      if (method.isDefault) {
        // Promote the most recent remaining method to default.
        const next = await tx.savedPaymentMethod.findFirst({
          where: { userId },
          orderBy: { createdAt: "desc" },
        });
        if (next) {
          await tx.savedPaymentMethod.update({
            where: { id: next.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { deleted: true };
  },

  async setDefault(userId: string, methodId: string) {
    const method = await prisma.savedPaymentMethod.findFirst({
      where: { id: methodId, userId },
    });
    if (!method) return { error: "NOT_FOUND" as const };

    const updated = await prisma.$transaction(async (tx) => {
      await tx.savedPaymentMethod.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      return tx.savedPaymentMethod.update({
        where: { id: method.id },
        data: { isDefault: true },
      });
    });
    return { method: serialize(updated) };
  },
};
