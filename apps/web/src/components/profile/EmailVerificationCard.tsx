"use client";

import { useEffect, useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, Loader2, MailCheck, MailWarning } from "lucide-react";
import {
  profilePanelPad,
  profilePanelShell,
} from "@/components/profile/profile-page-layout";
import { authApi } from "@/services/auth/auth-api";
import { AuthApiError } from "@/lib/auth/errors";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type SendState = "idle" | "sending" | "sent" | "rate_limited" | "error";

/**
 * Email verification — backend is the single source of truth.
 *   POST /api/auth/send-verification-email → emails a single-use 24h token link
 *   POST /api/auth/verify-email { token }  → the /verify-email page consumes it
 * This card surfaces status + lets the user (re)send the link; it never flips the
 * badge itself — only a real backend verification does.
 */
export function EmailVerificationCard() {
  const reduce = useReducedMotion();
  const user = useAuthStore((s) => s.user);
  const showToast = useAppStore((s) => s.showToast);
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState(0);

  // Countdown for rate-limit.
  useEffect(() => {
    if (retryAfter <= 0) return;
    const t = setInterval(() => {
      setRetryAfter((p) => {
        const next = p - 1;
        if (next <= 0) {
          clearInterval(t);
          setState("idle");
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [retryAfter]);

  // "Check your inbox" auto-resets to idle.
  useEffect(() => {
    if (state !== "sent") return;
    const t = setTimeout(() => setState("idle"), 8000);
    return () => clearTimeout(t);
  }, [state]);

  if (!user) return null;
  const verified = user.isEmailVerified;
  const verifiedAt = (user as { emailVerifiedAt?: string }).emailVerifiedAt;

  const send = async () => {
    if (state === "sending" || state === "rate_limited") return;
    setState("sending");
    setError(null);
    try {
      await authApi.sendVerificationEmail();
      setState("sent");
      showToast("Verification email sent — check your inbox", "success");
    } catch (e) {
      if (e instanceof AuthApiError && (e.status === 429 || e.code === "RATE_LIMIT_EXCEEDED")) {
        setRetryAfter(300);
        setState("rate_limited");
      } else if (e instanceof AuthApiError && e.code === "EMAIL_ALREADY_VERIFIED") {
        showToast("Your email is already verified", "info");
        setState("idle");
      } else {
        setError("Could not send the email. Please try again.");
        setState("error");
      }
    }
  };

  const tint = verified ? "text-success" : "text-warning";
  const badgeTint = verified ? "bg-success/15 text-success" : "bg-warning/15 text-warning";

  return (
    <motion.section
      initial={reduce ? false : { opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4 }}
      className={cn(profilePanelShell, "min-w-0", profilePanelPad)}
    >
      <div className="flex items-center gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg", verified ? "bg-success/15" : "bg-warning/15")}>
          {verified ? <BadgeCheck size={20} className={tint} /> : <MailWarning size={20} className={tint} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-bold text-content">Email</h2>
            <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase", badgeTint)}>
              {verified ? "Verified" : "Unverified"}
            </span>
          </div>
          <p className="truncate text-xs text-muted">
            {verified && verifiedAt
              ? `${user.email} · verified ${new Date(verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`
              : user.email}
          </p>
        </div>
        {!verified && state !== "sent" && (
          <button
            type="button"
            onClick={() => void send()}
            disabled={state === "sending" || state === "rate_limited"}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {state === "sending" && <Loader2 size={13} className="animate-spin" />}
            {state === "sending"
              ? "Sending…"
              : state === "rate_limited"
                ? `Resend in ${retryAfter}s`
                : "Verify email"}
          </button>
        )}
      </div>

      {!verified && state === "sent" && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-600/5 px-3 py-2 text-xs text-emerald-600">
          <MailCheck size={15} />
          <span>Check your inbox for the verification link — it expires in 24 hours.</span>
        </div>
      )}
      {!verified && state === "error" && error && (
        <p className="mt-2 text-xs text-error">{error}</p>
      )}
    </motion.section>
  );
}
