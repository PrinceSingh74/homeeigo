"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, Loader2, LogIn, Mail, Phone, Sparkles } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerStore } from "@/stores/partner-store";

type Tab = "password" | "otp";
type OtpStep = "phone" | "code";

function formatPhoneE164(local: string): string {
  const digits = local.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length >= 12) return `+${digits}`;
  return `+91${digits}`;
}

export function PartnerLoginForm() {
  const router = useRouter();
  const login = usePartnerStore((s) => s.login);
  const sendOtp = usePartnerStore((s) => s.sendOtp);
  const loginWithOtp = usePartnerStore((s) => s.loginWithOtp);
  const storeError = usePartnerStore((s) => s.error);
  const setError = usePartnerStore((s) => s.setError);

  const [tab, setTab] = useState<Tab>("password");
  const [otpStep, setOtpStep] = useState<OtpStep>("phone");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  function clearErrors() {
    setLocalError(null);
    setError(null);
    setDevOtp(null);
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    if (!email || !password) {
      setLocalError("Email and password are required");
      return;
    }
    setIsLoading(true);
    const result = await login(email.trim().toLowerCase(), password);
    setIsLoading(false);
    if (result.ok) router.replace("/");
    else setLocalError(result.message);
  }

  async function handlePhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      setLocalError("Enter a valid 10-digit mobile number");
      return;
    }
    setIsLoading(true);
    const result = await sendOtp(formatPhoneE164(phone));
    setIsLoading(false);
    if (result.ok) {
      setOtpStep("code");
      if (result.devOtp) {
        setDevOtp(result.devOtp);
        setOtp(result.devOtp);
      } else {
        setDevOtp(null);
      }
    } else {
      setLocalError(result.message);
    }
  }

  async function handleOtpSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearErrors();
    if (otp.replace(/\D/g, "").length !== 6) {
      setLocalError("Enter the 6-digit code");
      return;
    }
    setIsLoading(true);
    const result = await loginWithOtp(formatPhoneE164(phone), otp);
    setIsLoading(false);
    if (result.ok) router.replace("/");
    else setLocalError(result.message);
  }

  const errorToShow = localError || storeError;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div className="mb-8 text-center">
        {/* Light artwork on light UI; light-wordmark variant in night mode. */}
        <Image
          src="/brand/logo-full.png"
          alt="Homeeigo"
          width={560}
          height={386}
          priority
          className="mx-auto mb-4 h-[110px] w-40 object-contain dark:hidden"
        />
        <Image
          src="/brand/logo-full-dark.png"
          alt="Homeeigo"
          width={560}
          height={386}
          priority
          className="mx-auto mb-4 hidden h-[110px] w-40 object-contain dark:block"
        />
        <p className="font-display text-2xl font-bold tracking-tight">
          Partner <span className="text-partner-primary">Pro</span>
        </p>
        <p className="mt-2 text-sm text-partner-muted">
          Sign in to your partner dashboard — jobs, earnings, live tracking
        </p>
      </div>

      <PartnerCard glass>
        <div className="mb-4 flex gap-1 rounded-xl border border-partner-line bg-partner-bg/60 p-1">
          {(["password", "otp"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                clearErrors();
                setOtpStep("phone");
              }}
              className={`flex-1 rounded-lg py-2 text-xs font-semibold capitalize transition ${
                tab === t
                  ? "bg-partner-primary/20 text-partner-primary"
                  : "text-partner-muted hover:text-partner-text"
              }`}
            >
              {t === "password" ? "Email & password" : "Phone OTP"}
            </button>
          ))}
        </div>

        {tab === "password" ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            <div>
              <label className="text-xs text-partner-muted" htmlFor="partner-email">
                Email
              </label>
              <div className="relative mt-1">
                <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-partner-muted" />
                <input
                  id="partner-email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={isLoading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@homigo.in"
                  className="w-full rounded-xl border border-partner-line bg-partner-bg/60 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-partner-primary"
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-partner-muted" htmlFor="partner-password">
                Password
              </label>
              <input
                id="partner-password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isLoading}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary"
              />
            </div>

            {errorToShow ? <FormError message={errorToShow} /> : null}

            <PartnerButton type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {isLoading ? "Signing in…" : "Sign in"}
            </PartnerButton>
          </form>
        ) : otpStep === "phone" ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-3">
            <label className="text-xs text-partner-muted">Mobile number</label>
            <div className="flex gap-2">
              <span className="flex items-center rounded-xl border border-partner-line bg-partner-bg/60 px-3 text-sm">
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={phone}
                disabled={isLoading}
                onChange={(e) =>
                  setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                }
                placeholder="98765 43210"
                className="flex-1 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary"
              />
            </div>

            {errorToShow ? <FormError message={errorToShow} /> : null}

            <PartnerButton type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
              {isLoading ? "Sending OTP…" : "Send OTP"}
            </PartnerButton>
            <p className="text-center text-[11px] text-partner-muted">
              We&apos;ll send a 6-digit code to verify your number.
            </p>
          </form>
        ) : (
          <form onSubmit={handleOtpSubmit} className="space-y-3">
            <p className="text-sm text-partner-muted">
              Enter the 6-digit code sent to{" "}
              <span className="text-partner-text">+91 {phone}</span>
            </p>
            {devOtp ? (
              <div className="rounded-lg border border-partner-primary/30 bg-partner-primary/10 px-3 py-2 text-xs text-partner-primary">
                Dev mode: SMS not configured. Your code is{" "}
                <span className="font-mono font-bold tracking-widest">{devOtp}</span> (auto-filled).
              </div>
            ) : null}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={otp}
              disabled={isLoading}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-3 text-center font-mono text-lg tracking-[0.5em] outline-none focus:border-partner-primary"
              placeholder="------"
            />

            {errorToShow ? <FormError message={errorToShow} /> : null}

            <PartnerButton type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isLoading ? "Verifying…" : "Verify & continue"}
            </PartnerButton>
            <button
              type="button"
              onClick={() => {
                setOtpStep("phone");
                setOtp("");
                clearErrors();
              }}
              disabled={isLoading}
              className="w-full text-center text-[11px] text-partner-muted underline"
            >
              Change number
            </button>
          </form>
        )}
      </PartnerCard>

      <p className="mt-6 text-center text-xs text-partner-muted">
        Not a HOMEEIGO partner yet?{" "}
        <a href="/register" className="font-medium text-partner-primary hover:underline">
          Register as a partner
        </a>
      </p>
    </motion.div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-partner-danger/30 bg-partner-danger/10 px-3 py-2 text-xs text-partner-danger"
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
