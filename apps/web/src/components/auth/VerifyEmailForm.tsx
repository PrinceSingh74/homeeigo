"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailCheck, XCircle } from "lucide-react";
import { authApi } from "@/services/auth/auth-api";
import { AuthApiError } from "@/lib/auth/errors";
import { useAuthStore } from "@/stores/auth-store";

type State = "verifying" | "success" | "error" | "prompt";

/**
 * Consumes the email verification token from the URL and verifies it against the
 * backend (single source of truth). No page reload — everything is client-side;
 * on success we refresh the current user so the badge flips, then redirect home.
 *
 * Without a token the page acts as a routed verification hub:
 * - signed out            → redirect to /login (come back after signing in)
 * - signed in, verified   → nothing to do, redirect home
 * - signed in, unverified → offer to (re)send the verification email
 */
export function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const token = params.get("token");
  const [state, setState] = useState<State>(token ? "verifying" : "prompt");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const ran = useRef(false);

  const isInitializing = status === "initializing" || status === "idle";
  const isAuthenticated = status === "authenticated" && !!user;

  // Tokenless visits: route the user to the right place instead of erroring out.
  useEffect(() => {
    if (token || isInitializing) return;
    if (!isAuthenticated) {
      router.replace("/login?returnUrl=%2Fverify-email");
      return;
    }
    if (user?.isEmailVerified) {
      router.replace("/");
    }
  }, [token, isInitializing, isAuthenticated, user?.isEmailVerified, router]);

  const resend = async () => {
    setSending(true);
    setError(null);
    try {
      const res = await authApi.sendVerificationEmail();
      setSentTo(res.data?.email ?? user?.email ?? null);
    } catch (e) {
      if (e instanceof AuthApiError && e.code === "EMAIL_ALREADY_VERIFIED") {
        try {
          await fetchCurrentUser();
        } catch {
          /* ignore */
        }
        router.replace("/");
        return;
      }
      setError("Could not send the verification email. Please try again in a moment.");
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (!token) {
      setState("prompt");
      return;
    }
    setState("verifying");
    try {
      await authApi.verifyEmail(token);
      try {
        await fetchCurrentUser(); // refresh badge if the user is logged in here
      } catch {
        /* not logged in on this device — verification still succeeded */
      }
      setState("success");
      setTimeout(() => router.push("/"), 3000);
    } catch (e) {
      setState("error");
      if (e instanceof AuthApiError && e.code === "EMAIL_ALREADY_VERIFIED") {
        setError("This email is already verified. You're all set.");
      } else {
        setError("This verification link is invalid or has expired. Please request a new one.");
      }
    }
  };

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md rounded-[28px] glass-card p-8 text-center shadow-e5">
        <div className="mb-6 font-display text-2xl font-bold text-primary">HOMEEIGO</div>

        {state === "prompt" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <MailCheck size={48} className="text-primary" strokeWidth={1.8} />
            <div>
              <h1 className="font-display text-xl font-bold text-content">Verify your email</h1>
              <p className="mt-1 text-sm text-muted">
                {sentTo
                  ? `Verification link sent to ${sentTo}. Check your inbox (and spam folder).`
                  : user?.email
                    ? `We'll send a verification link to ${user.email}.`
                    : "We'll send a verification link to your registered email."}
              </p>
              {error ? <p className="mt-2 text-sm text-error">{error}</p> : null}
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => void resend()}
                disabled={sending || isInitializing}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1D4ED8] disabled:opacity-60"
              >
                {sending ? "Sending…" : sentTo ? "Resend email" : "Send verification email"}
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content"
              >
                Go home
              </button>
            </div>
          </div>
        )}

        {state === "verifying" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <Loader2 size={44} className="animate-spin text-primary" />
            <div>
              <h1 className="font-display text-xl font-bold text-content">Verifying your email…</h1>
              <p className="mt-1 text-sm text-muted">Please wait a moment.</p>
            </div>
          </div>
        )}

        {state === "success" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CheckCircle2 size={52} className="text-success" strokeWidth={1.8} />
            <div>
              <h1 className="font-display text-xl font-bold text-content">Email verified!</h1>
              <p className="mt-1 text-sm text-muted">Your email has been verified successfully.</p>
              <p className="mt-2 text-xs text-muted">Redirecting you home…</p>
            </div>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center gap-4 py-4">
            <XCircle size={52} className="text-error" strokeWidth={1.8} />
            <div>
              <h1 className="font-display text-xl font-bold text-content">Verification failed</h1>
              <p className="mt-1 text-sm text-muted">{error}</p>
            </div>
            <div className="flex w-full gap-2">
              <button
                type="button"
                onClick={() => void verify()}
                className="flex-1 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#1D4ED8]"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => router.push("/")}
                className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-content"
              >
                Go home
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
