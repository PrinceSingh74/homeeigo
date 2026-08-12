import { z } from "zod";

const specialChar = /[!@#$%^&*()_+\-=[\]{};:'",.<>/?]/;

export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Enter a valid email address");

// Mirrors the backend register rules so the signup form never accepts a
// password the backend will reject (which previously surfaced as a confusing
// "Weak password" error on the OTP screen).
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .regex(/[A-Z]/, "Include at least one uppercase letter")
  .regex(/[a-z]/, "Include at least one lowercase letter")
  .regex(/[0-9]/, "Include at least one number")
  .regex(specialChar, "Include at least one special character");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z
  .object({
    firstName: z.string().min(1, "First name is required").max(80),
    lastName: z.string().min(1, "Last name is required").max(80),
    email: emailSchema,
    phoneNumber: z
      .string()
      .min(6, "Enter a valid phone number")
      .max(20, "Phone number is too long"),
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
    agreeToTerms: z.literal(true, {
      message: "You must agree to the Terms and Privacy Policy",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((data) => !data.password.toLowerCase().includes(data.email.split("@")[0]!.toLowerCase()), {
    message: "Password must not be similar to your email",
    path: ["password"],
  });

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const verifyOtpSchema = z.object({
  otp: z
    .string()
    .length(6, "Enter the 6-digit code")
    .regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type SignupFormValues = z.infer<typeof signupSchema>;
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>;
export type VerifyOtpFormValues = z.infer<typeof verifyOtpSchema>;
