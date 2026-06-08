import { z } from "zod";
import { emailSchema, passwordSchema, phoneSchema } from "./auth.schema";
import { idSchema } from "./common.schema";

const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "Invalid PAN format");

const aadharSchema = z.string().trim().regex(/^\d{12}$/, "Aadhaar must be 12 digits");

const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Invalid IFSC format");

const bankAccountSchema = z.string().trim().regex(/^\d{9,18}$/, "Invalid bank account number");

export const partnerRegisterStep1Schema = z
  .object({
    email: emailSchema,
    phoneNumber: z.string().trim().min(10).max(15),
    firstName: z.string().trim().min(2).max(50),
    lastName: z.string().trim().min(2).max(50),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const partnerVerifyOtpSchema = z.object({
  email: emailSchema,
  otp: z.string().length(6).regex(/^\d{6}$/),
  userId: idSchema,
});

export const partnerServicesSchema = z.object({
  serviceCategories: z.array(z.string().trim().min(1).max(80)).min(1),
  city: z.string().trim().min(2).max(100),
  experienceYears: z.number().int().min(0).max(50),
});

export const partnerKycSchema = z.object({
  panNumber: panSchema.optional(),
  aadharNumber: aadharSchema.optional(),
  bankAccountNumber: bankAccountSchema.optional(),
  bankAccountHolder: z.string().trim().min(2).max(100).optional(),
  ifscCode: ifscSchema.optional(),
  bankName: z.string().trim().min(2).max(100).optional(),
});

export type PartnerRegisterStep1Input = z.infer<typeof partnerRegisterStep1Schema>;
export type PartnerKycInput = z.infer<typeof partnerKycSchema>;

/** Normalize partner phone to E.164 +91 for downstream services. */
export function normalizePartnerPhone(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  return local.startsWith("+") ? local : `+${digits}`;
}

export const indiaPhoneSchema = phoneSchema;
