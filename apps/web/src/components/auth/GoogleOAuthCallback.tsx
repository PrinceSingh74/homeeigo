"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { m as motion, useReducedMotion } from "framer-motion";
import { AlertCircle, Loader2, Sparkles } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/buttons/Button";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { Card } from "@/components/cards/Card";
import { fadeUpShow } from "@/lib/animations";
import {
  claimOAuthAuthorizationCode,
  consumeGoogleOAuthPending,
  finishOAuthAuthorizationCode,
  getGoogleOAuthUserMessage,
  sanitizeOAuthReturnUrl,
} from "@/lib/auth/google-oauth";
import { pagePadX } from "@/lib/page-layout";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

type CallbackPhase = "loading" | "error" | "success";

export function GoogleOAuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reduce = useReducedMotion();
  const startedRef = useRef(false);
  const paramsRef = useRef({
    error: searchParams.get("error"),
    code: searchParams.get("code"),
    state: searchParams.get("state"),
    returnUrl: searchParams.get("returnUrl"),
  });

  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const setError = useAuthStore((s) => s.setError);
  const status = useAuthStore((s) => s.status);
  const showToast = useAppStore((s) => s.showToast);

  const [phase, setPhase] = useState<CallbackPhase>("loading");
  const [message, setMessage] = useState("Completing Google sign-in…");

  useEffect(() => {
    if (startedRef.current) return;

    const { error: oauthError, code, state, returnUrl: returnUrlFromQuery } =
      paramsRef.current;

    if (!oauthError && !code) {
      if (status === "idle" || status === "initializing") return;
      startedRef.current = true;
      if (status === "authenticated") {
        router.replace(sanitizeOAuthReturnUrl(returnUrlFromQuery));
        return;
      }
      setPhase("error");
      setMessage("Missing authorization code. Please try signing in again.");
      return;
    }

    startedRef.current = true;

    async function complete() {
      if (oauthError) {
        setPhase("error");
        setMessage(getGoogleOAuthUserMessage(oauthError));
        return;
      }

      const pending = consumeGoogleOAuthPending(state);
      const returnUrl = pending.valid
        ? pending.returnUrl
        : sanitizeOAuthReturnUrl(returnUrlFromQuery);

      if (status === "authenticated") {
        router.replace(returnUrl);
        return;
      }

      // Only a genuine state mismatch is a hard CSRF failure. A missing/expired local
      // token (OAuth returned to a different tab/origin, or the page was refreshed) is
      // recoverable: the backend validates the state via oauthStateService, so proceed.
      if (!pending.valid && pending.localMismatch) {
        setPhase("error");
        setMessage(pending.error);
        return;
      }

      if (!code) {
        setPhase("error");
        setMessage("Missing authorization code. Please try signing in again.");
        return;
      }

      const claim = claimOAuthAuthorizationCode(code);
      if (claim === "in_flight") return;
      if (claim === "duplicate") {
        if (useAuthStore.getState().status === "authenticated") {
          router.replace(returnUrl);
        } else {
          setPhase("error");
          setMessage(
            "This sign-in link was already used or is no longer valid. Please try again.",
          );
        }
        return;
      }

      setPhase("loading");
      setMessage("Securing your HOMEEIGO session…");

      const result = await runAuthAction(() => signInWithGoogle(code, state), setError);

      if (!result.ok) {
        finishOAuthAuthorizationCode(code, false);
        setPhase("error");
        setMessage(result.message);
        return;
      }

      finishOAuthAuthorizationCode(code, true);
      setPhase("success");
      setMessage("Welcome back!");
      showToast("Signed in with Google", "success");
      router.replace(returnUrl);
    }

    void complete();
  }, [router, showToast, signInWithGoogle, setError, status]);

  return (
    <div className="relative flex min-h-dvh flex-col">
      <AuroraBackground />
      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col items-center justify-center py-10 sm:py-14",
          pagePadX,
        )}
      >
        <motion.div
          className="w-full max-w-md text-center"
          initial={reduce ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.div variants={fadeUpShow} custom={0} initial={false} animate="show">
            <Badge variant="ai" className="mb-4">
              <Sparkles size={14} aria-hidden />
              Google sign-in
            </Badge>
          </motion.div>

          <h1 className="font-display text-[clamp(1.75rem,4.5vw,2.25rem)] font-bold tracking-tight text-content">
            {phase === "error" ? "Sign-in interrupted" : "Almost there"}
          </h1>
          <p className="mt-2 text-base leading-relaxed text-muted sm:text-lg">{message}</p>

          <Card variant="default" className="mt-8 p-6 sm:p-8">
            {phase === "loading" || phase === "success" ? (
              <div className="flex flex-col items-center gap-4 py-2">
                <Loader2
                  className="size-10 animate-spin text-primary"
                  aria-label={phase === "success" ? "Redirecting" : "Loading"}
                />
                <p className="text-sm text-muted">
                  {phase === "success" ? "Redirecting you now…" : "Please wait a moment"}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex justify-center">
                  <span className="grid size-12 place-items-center rounded-2xl bg-error/10 text-error">
                    <AlertCircle className="size-6" aria-hidden />
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-muted" role="alert">
                  {message}
                </p>
                <Button
                  type="button"
                  fullWidth
                  size="lg"
                  onClick={() => router.replace("/login")}
                >
                  Try again
                </Button>
                <ButtonLink href="/" variant="ghost" fullWidth size="md">
                  Back to home
                </ButtonLink>
              </div>
            )}
          </Card>

          {phase === "error" ? (
            <p className="mt-6 text-sm text-muted">
              Need help?{" "}
              <Link href="/login" className="font-semibold text-primary hover:text-primary/80">
                Use email sign-in
              </Link>
            </p>
          ) : null}
        </motion.div>
      </div>
    </div>
  );
}
