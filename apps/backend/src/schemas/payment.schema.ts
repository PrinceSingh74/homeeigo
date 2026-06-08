import { z } from "zod";
import { idSchema } from "./common.schema";

/**
 * Part 5 — Input Validation (Zod schemas) for payment flows.
 */

export const createOrderSchema = z.object({
  bookingId: idSchema,
  amount: z.number().positive("Amount must be positive").max(1_000_000, "Amount too large").optional(),
  currency: z.enum(["INR", "USD"]).default("INR"),
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().trim().min(1, "Order ID required"),
  razorpayPaymentId: z.string().trim().min(1, "Payment ID required"),
  razorpaySignature: z.string().trim().min(1, "Signature required"),
});

export const walletTopUpSchema = z.object({
  amount: z.number().positive("Amount must be positive").max(1_000_000, "Amount too large"),
});

const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format");

export const walletWithdrawSchema = z.object({
  amount: z.number().positive("Amount must be positive").max(1_000_000, "Amount too large"),
  bankAccountNumber: z.string().trim().regex(/^\d{9,18}$/, "Invalid bank account number"),
  ifscCode: ifscSchema,
  accountHolder: z.string().trim().min(2).max(100),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type WalletTopUpInput = z.infer<typeof walletTopUpSchema>;
export type WalletWithdrawInput = z.infer<typeof walletWithdrawSchema>;
