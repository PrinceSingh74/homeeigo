"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthFooterLink } from "@/components/auth/AuthFooterLink";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { OtpInput } from "@/components/auth/OtpInput";
import { Button } from "@/components/buttons/Button";
import {
  clearPendingRegistration,
  loadPendingRegistration,
} from "@/lib/auth/pending-registration";
import { verifyOtpSchema } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

export function VerifyOtpForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flow = searchParams.get("flow") ?? "register";
  const phone = searchParams.get("phone") ?? "";

  const register = useAuthStore((s) => s.register);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const user = useAuthStore((s) => s.user);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (flow === "register" && !phone) {
      router.replace("/signup");
    }
  }, [flow, phone, router]);

  async function handleResend() {
    if (!phone || resendCooldown > 0) return;
    setIsLoading(true);
    const result = await runAuthAction(
      () => sendOtp(phone, user?.id),
      setError,
    );
    setIsLoading(false);
    if (result.ok) {
      showToast("Code sent again", "success");
      setResendCooldown(30);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = verifyOtpSchema.safeParse({ otp });
    if (!parsed.success) {
      setOtpError(parsed.error.issues[0]?.message);
      return;
    }
    setOtpError(undefined);

    if (!phone) return;

    setIsLoading(true);

    if (flow === "register") {
      const pending = loadPendingRegistration();
      if (!pending) {
        setIsLoading(false);
        showToast("Session expired. Please sign up again.", "error");
        router.replace("/signup");
        return;
      }

      const result = await runAuthAction(
        () => register({ ...pending, otp: parsed.data.otp }),
        setError,
      );
      setIsLoading(false);

      if (result.ok) {
        clearPendingRegistration();
        showToast("Welcome to HOMEEIGO", "success");
        router.replace("/");
      } else if (/password/i.test(result.message)) {
        // A password problem (weak / too common / similar to email) can't be
        // fixed on the OTP screen — send the user back to signup to correct it.
        showToast(`${result.message}. Please update your password.`, "error");
        router.replace("/signup");
      }
      return;
    }

    const result = await runAuthAction(
      () => verifyOtp(phone, parsed.data.otp, user?.id),
      setError,
    );
    setIsLoading(false);

    if (result.ok) {
      showToast("Phone verified", "success");
      router.replace("/profile");
    }
  }

  const displayPhone = phone.replace(/^\+91/, "+91 ");

  return (
    <AuthPageShell
      title="Verify your number"
      subtitle={
        phone
          ? `Enter the 6-digit code sent to ${displayPhone}.`
          : "Enter the verification code we sent to your phone."
      }
      badge="Phone verification"
      backHref={flow === "register" ? "/signup" : "/profile"}
      footer={
        flow === "register" ? (
          <AuthFooterLink prompt="Wrong number?" href="/signup" label="Edit signup" />
        ) : (
          <AuthFooterLink prompt="Done?" href="/profile" label="Back to profile" />
        )
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit} noValidate>
        <OtpInput value={otp} onChange={setOtp} disabled={isLoading} error={!!otpError} />
        {otpError ? (
          <p className="text-center text-sm text-error" role="alert">
            {otpError}
          </p>
        ) : null}

        {storeError ? (
          <p className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
            {storeError}
          </p>
        ) : null}

        <Button
          type="submit"
          fullWidth
          size="lg"
          isLoading={isLoading}
          icon={<ShieldCheck className="size-4" />}
        >
          {flow === "register" ? "Verify & create account" : "Verify phone"}
        </Button>

        <p className="text-center text-sm text-muted">
          Didn&apos;t receive a code?{" "}
          <button
            type="button"
            disabled={resendCooldown > 0 || isLoading || !phone}
            className="font-semibold text-primary hover:text-primary/80 disabled:opacity-50"
            onClick={() => void handleResend()}
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </button>
        </p>

        {flow === "register" ? (
          <p className="text-center text-xs text-muted">
            <Link href="/login" className="font-semibold text-primary hover:text-primary/80">
              Already verified? Sign in
            </Link>
          </p>
        ) : null}
      </form>
    </AuthPageShell>
  );
}
