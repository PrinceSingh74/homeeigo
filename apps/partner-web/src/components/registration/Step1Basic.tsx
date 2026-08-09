"use client";

import { useState } from "react";
import { z } from "zod";
import { PartnerButton } from "@/components/ui/PartnerButton";

const accountSchema = z
  .object({
    firstName: z.string().min(2, "Min 2 characters"),
    lastName: z.string().min(2, "Min 2 characters"),
    email: z.string().email("Invalid email"),
    phoneNumber: z.string().regex(/^[0-9]{10}$/, "Enter 10 digit number"),
    password: z.string().min(8, "Min 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type Step1AccountData = z.infer<typeof accountSchema>;

type Props = {
  otpSent: boolean;
  devOtpHint: string | null;
  loading: boolean;
  onRegister: (data: Step1AccountData) => Promise<void>;
  onVerifyOtp: (otp: string) => Promise<void>;
};

const inputClass =
  "w-full rounded-lg border border-[var(--color-partner-border)] bg-[var(--color-partner-surface)] px-4 py-2.5 text-sm outline-none focus:border-partner-primary";

export function Step1Basic({
  otpSent,
  devOtpHint,
  loading,
  onRegister,
  onVerifyOtp,
}: Props) {
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
    otp: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      const validated = accountSchema.parse(formData);
      setErrors({});
      await onRegister(validated);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const next: Record<string, string> = {};
        err.errors.forEach((e) => {
          if (e.path[0]) next[String(e.path[0])] = e.message;
        });
        setErrors(next);
      }
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (formData.otp.length !== 6) {
      setErrors({ otp: "Enter 6-digit OTP" });
      return;
    }
    setErrors({});
    await onVerifyOtp(formData.otp);
  }

  return (
    <div className="space-y-5">
      <h2 className="text-xl font-semibold">Basic information</h2>
      <p className="text-sm text-[var(--color-partner-muted)]">
        Create your partner account. We verify your mobile with OTP.
      </p>

      <form
        onSubmit={otpSent ? handleVerify : handleRegister}
        className="space-y-5"
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <input
              type="text"
              name="firstName"
              placeholder="First name"
              value={formData.firstName}
              onChange={handleChange}
              disabled={otpSent}
              className={inputClass}
            />
            {errors.firstName ? (
              <p className="mt-1 text-xs text-red-400">{errors.firstName}</p>
            ) : null}
          </div>
          <div>
            <input
              type="text"
              name="lastName"
              placeholder="Last name"
              value={formData.lastName}
              onChange={handleChange}
              disabled={otpSent}
              className={inputClass}
            />
            {errors.lastName ? (
              <p className="mt-1 text-xs text-red-400">{errors.lastName}</p>
            ) : null}
          </div>
        </div>

        <div>
          <input
            type="email"
            name="email"
            placeholder="Email"
            value={formData.email}
            onChange={handleChange}
            disabled={otpSent}
            className={inputClass}
          />
          {errors.email ? <p className="mt-1 text-xs text-red-400">{errors.email}</p> : null}
        </div>

        <div className="flex gap-2">
          <span className="flex items-center rounded-lg border border-[var(--color-partner-border)] bg-[var(--color-partner-surface)] px-3 text-sm text-[var(--color-partner-muted)]">
            +91
          </span>
          <input
            type="tel"
            name="phoneNumber"
            placeholder="10-digit mobile"
            value={formData.phoneNumber}
            onChange={handleChange}
            disabled={otpSent}
            maxLength={10}
            className={`${inputClass} flex-1`}
          />
        </div>
        {errors.phoneNumber ? (
          <p className="-mt-3 text-xs text-red-400">{errors.phoneNumber}</p>
        ) : null}

        {!otpSent ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <input
                type="password"
                name="password"
                placeholder="Password"
                value={formData.password}
                onChange={handleChange}
                className={inputClass}
              />
              {errors.password ? (
                <p className="mt-1 text-xs text-red-400">{errors.password}</p>
              ) : null}
            </div>
            <div>
              <input
                type="password"
                name="confirmPassword"
                placeholder="Confirm"
                value={formData.confirmPassword}
                onChange={handleChange}
                className={inputClass}
              />
              {errors.confirmPassword ? (
                <p className="mt-1 text-xs text-red-400">{errors.confirmPassword}</p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {devOtpHint ? (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                Dev OTP: <strong className="font-mono">{devOtpHint}</strong>
              </p>
            ) : (
              <p className="text-sm text-[var(--color-partner-muted)]">
                OTP sent to +91{formData.phoneNumber}
              </p>
            )}
            <input
              type="text"
              name="otp"
              placeholder="6-digit OTP"
              value={formData.otp}
              onChange={handleChange}
              maxLength={6}
              className={inputClass}
              autoFocus
            />
            {errors.otp ? <p className="text-xs text-red-400">{errors.otp}</p> : null}
          </>
        )}

        <PartnerButton type="submit" className="w-full" disabled={loading}>
          {loading
            ? "Please wait…"
            : otpSent
              ? "Verify & continue"
              : "Send OTP & create account"}
        </PartnerButton>
      </form>
    </div>
  );
}
