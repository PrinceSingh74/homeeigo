"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Lock, ShieldCheck, Smartphone } from "lucide-react";
import { formatPhoneE164, PhoneField } from "@/components/auth/PhoneField";
import { OtpInput } from "@/components/auth/OtpInput";
import { Button } from "@/components/buttons/Button";
import { loginPhoneSchema, verifyOtpSchema } from "@/lib/auth/schemas";
import { authApi, type SendOtpPayload } from "@/services/auth/auth-api";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";

type OtpStep = "phone" | "code";

type PhoneOtpLoginFormProps = {
  onAuthenticated: () => void;
  oauthSlot?: (disabled: boolean) => ReactNode;
};

function maskPhone(local: string): string {
  const digits = local.replace(/\D/g, "").slice(0, 10);
  if (digits.length !== 10) return `+91 ${digits}`;
  return `+91 ${digits.slice(0, 2)}••• ••${digits.slice(8)}`;
}

export function PhoneOtpLoginForm({ onAuthenticated, oauthSlot }: PhoneOtpLoginFormProps) {
  const setSession = useAuthStore((s) => s.setSession);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);

  const [step, setStep] = useState<OtpStep>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneError, setPhoneError] = useState<string | undefined>();
  const [otpError, setOtpError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [smsSent, setSmsSent] = useState(false);
  const submittedOtpRef = useRef<string | null>(null);
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  function clearAlerts() {
    setPhoneError(undefined);
    setOtpError(undefined);
    setError(null);
  }

  async function requestCode(nextPhone: string) {
    setIsLoading(true);
    const result = await runAuthAction(async (): Promise<Partial<SendOtpPayload>> => {
      const res = await authApi.sendOtp(formatPhoneE164(nextPhone));
      // Annotated, not inferred: `res.data ?? {}` infers `SendOtpPayload | {}`, which collapses to
      // `{}` — so `result.data.devOtp` and `.smsSent` stopped existing and the app typecheck went red.
      return res.data ?? {};
    }, setError);
    setIsLoading(false);
    if (!result.ok) return false;

    setStep("code");
    setResendCooldown(30);
    submittedOtpRef.current = null;
    setSmsSent(Boolean(result.data.smsSent));
    if (result.data.devOtp) {
      setDevOtp(result.data.devOtp);
      setOtp(result.data.devOtp);
    } else {
      setDevOtp(null);
      setOtp("");
    }
    return true;
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearAlerts();
    const parsed = loginPhoneSchema.safeParse({ phoneNumber: phone });
    if (!parsed.success) {
      setPhoneError(parsed.error.issues[0]?.message);
      return;
    }
    await requestCode(parsed.data.phoneNumber);
  }

  async function verify(code: string) {
    if (verifyingRef.current) return;
    const parsed = verifyOtpSchema.safeParse({ otp: code });
    if (!parsed.success) {
      setOtpError(parsed.error.issues[0]?.message);
      return;
    }
    setOtpError(undefined);
    verifyingRef.current = true;
    setIsLoading(true);
    const result = await runAuthAction(async () => {
      const session = await authApi.verifyOtpSession(formatPhoneE164(phone), parsed.data.otp);
      setSession(session.user, session.accessToken);
    }, setError);
    verifyingRef.current = false;
    setIsLoading(false);
    if (result.ok) onAuthenticated();
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearAlerts();
    await verify(otp);
  }

  useEffect(() => {
    // When SMS is skipped, the code is shown on screen — don't auto-submit so the user can see it.
    if (devOtp) return;
    if (step !== "code" || otp.length !== 6 || isLoading) return;
    if (submittedOtpRef.current === otp) return;
    submittedOtpRef.current = otp;
    void verify(otp);
    // verify is stable enough for this auto-submit; deps stay on the OTP value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step, isLoading, devOtp]);

  const missingAccount = Boolean(
    storeError && /no homeeigo account|user not found/i.test(storeError),
  );

  if (step === "phone") {
    return (
      <form className="space-y-4" onSubmit={handlePhoneSubmit} noValidate>
        <PhoneField
          value={phone}
          onChange={setPhone}
          errorMessage={phoneError}
          disabled={isLoading}
          autoFocus
          helperText="We'll send a 6-digit code by SMS via Twilio."
        />

        {storeError ? (
          <AuthAlert message={storeError} showSignup={missingAccount} />
        ) : null}

        <Button
          type="submit"
          fullWidth
          size="lg"
          isLoading={isLoading}
          icon={<Smartphone className="size-4" />}
        >
          Send code
        </Button>

        <TrustNote />
        {oauthSlot?.(isLoading)}
      </form>
    );
  }

  return (
    <form className="space-y-5" onSubmit={handleOtpSubmit} noValidate>
      <div className="text-center">
        <p className="text-sm leading-relaxed text-muted">
          {smsSent
            ? "Enter the 6-digit code we texted to "
            : "Enter the 6-digit code for "}
          <span className="font-semibold text-content">{maskPhone(phone)}</span>
        </p>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => {
            setStep("phone");
            setOtp("");
            setDevOtp(null);
            setSmsSent(false);
            submittedOtpRef.current = null;
            clearAlerts();
          }}
          className="mt-1 text-sm font-semibold text-primary hover:text-primary/80 disabled:opacity-50"
        >
          Change number
        </button>
      </div>

      {devOtp ? (
        <p className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-center text-xs font-medium text-primary">
          Twilio could not deliver SMS to this number (trial accounts only text verified numbers).
          Your code is{" "}
          <span className="font-mono text-sm font-bold tracking-[0.35em]">{devOtp}</span>
        </p>
      ) : null}

      <OtpInput value={otp} onChange={setOtp} disabled={isLoading} error={!!otpError} />
      {otpError ? (
        <p className="text-center text-sm text-error" role="alert">
          {otpError}
        </p>
      ) : null}

      {storeError ? <AuthAlert message={storeError} showSignup={missingAccount} /> : null}

      <Button
        type="submit"
        fullWidth
        size="lg"
        isLoading={isLoading}
        icon={<ShieldCheck className="size-4" />}
      >
        Verify & sign in
      </Button>

      <p className="text-center text-sm text-muted">
        Didn&apos;t receive a code?{" "}
        <button
          type="button"
          disabled={resendCooldown > 0 || isLoading}
          className="font-semibold text-primary hover:text-primary/80 disabled:opacity-50"
          onClick={() => {
            clearAlerts();
            void requestCode(phone);
          }}
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
        </button>
      </p>
    </form>
  );
}

function TrustNote() {
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted">
      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Your number is used only to sign you in. We never share it.
    </p>
  );
}

function AuthAlert({ message, showSignup }: { message: string; showSignup: boolean }) {
  return (
    <div className="rounded-xl bg-error/10 px-3 py-2 text-sm font-medium text-error" role="alert">
      <p>{message}</p>
      {showSignup ? (
        <p className="mt-1.5 font-normal text-content">
          New here?{" "}
          <Link href="/signup" className="font-semibold text-primary hover:text-primary/80">
            Create an account
          </Link>
        </p>
      ) : null}
    </div>
  );
}
