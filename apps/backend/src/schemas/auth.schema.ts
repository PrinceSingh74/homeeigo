import { z } from "zod";

/**
 * Part 5 — Input Validation (Zod schemas) for authentication flows.
 *
 * These mirror the password/phone rules already enforced by the auth routes
 * and `PasswordService`, but centralise them so every entry point validates
 * inputs the same way before any business logic runs.
 */

export const emailSchema = z.string().trim().toLowerCase().email("Invalid email address");

// India E.164 phone numbers: +91 followed by 10 digits.
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+91\d{10}$/, "Phone number must be in +91XXXXXXXXXX format");

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password too long")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[0-9]/, "Password must contain a number")
  .regex(/[!@#$%^&*()_+\-=[\]{};:'",.<>/?]/, "Password must contain a special character");

const nameSchema = z.string().trim().min(2, "Too short").max(50, "Too long");

export const registerSchema = z
  .object({
    email: emailSchema,
    phoneNumber: phoneSchema,
    firstName: nameSchema,
    lastName: nameSchema,
    password: passwordSchema,
    confirmPassword: z.string().optional(),
    userType: z.enum(["customer", "vendor"]).default("customer"),
    agreeToTerms: z.literal(true, { message: "You must agree to the Terms of Service and Privacy Policy" }),
    otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits").optional(),
    deviceId: z.string().max(128).optional(),
    deviceName: z.string().max(128).optional(),
    browserFingerprint: z.string().max(256).optional(),
    deviceFingerprint: z.string().max(256).optional(),
    timezone: z.string().max(64).optional(),
    setAuthCookies: z.boolean().optional(),
    referralCode: z.string().trim().max(32).optional(),
  })
  .refine((data) => data.confirmPassword === undefined || data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password required").max(128),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
  setAuthCookies: z.boolean().optional(),
});

export const otpRequestSchema = z.object({
  phoneNumber: phoneSchema,
  userId: z.string().max(128).optional(),
});

export const otpVerifySchema = z.object({
  phoneNumber: phoneSchema,
  otp: z.string().length(6, "OTP must be 6 digits").regex(/^\d{6}$/, "OTP must be numeric"),
});

/** Auth `/verify-otp` — supports phone-only or email lookup flows. */
export const otpVerifyAuthSchema = z.object({
  phoneNumber: phoneSchema.optional(),
  email: emailSchema.optional(),
  otp: z.string().length(6, "OTP must be 6 digits").regex(/^\d{6}$/, "OTP must be numeric"),
  userId: z.string().max(128).optional(),
  completeRegistration: z.boolean().optional(),
  login: z.boolean().optional(),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
  setAuthCookies: z.boolean().optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token required"),
  deviceId: z.string().max(128).optional(),
  deviceName: z.string().max(128).optional(),
  setAuthCookies: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Reset token required"),
    newPassword: passwordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine((data) => data.confirmPassword === undefined || data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password required"),
    newPassword: passwordSchema,
    confirmPassword: z.string().optional(),
  })
  .refine(
    (data) => data.confirmPassword === undefined || data.newPassword === data.confirmPassword,
    {
      message: "New passwords don't match",
      path: ["confirmPassword"],
    },
  )
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

export const updateProfileSchema = z.object({
  firstName: nameSchema.optional(),
  lastName: nameSchema.optional(),
  phoneNumber: phoneSchema.optional(),
  bio: z.string().trim().max(500, "Bio too long").optional(),
  profileImage: z.string().url("Invalid image URL").optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
