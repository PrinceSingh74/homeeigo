"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/buttons/Button";
import { beginAppleOAuth } from "@/lib/auth/apple-oauth";
import { beginGoogleOAuth } from "@/lib/auth/google-oauth";
import { authApi } from "@/services/auth/auth-api";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/stores/app-store";

type Provider = "google" | "apple";

type OAuthProviderButtonsProps = {
  disabled?: boolean;
  /** Show divider above the buttons. Defaults to true. */
  withDivider?: boolean;
};

export function OAuthProviderButtons({
  disabled,
  withDivider = true,
}: OAuthProviderButtonsProps) {
  const searchParams = useSearchParams();
  const setError = useAuthStore((s) => s.setError);
  const showToast = useAppStore((s) => s.showToast);
  const [loadingProvider, setLoadingProvider] = useState<Provider | null>(null);

  async function start(provider: Provider) {
    setLoadingProvider(provider);
    const returnUrl = searchParams.get("returnUrl");
    try {
      if (provider === "google") {
        const state = beginGoogleOAuth(returnUrl);
        const result = await runAuthAction(() => authApi.googleAuthorize(state), setError);
        if (result.ok) window.location.href = result.data;
        else showToast(result.message, "error");
      } else {
        const state = beginAppleOAuth(returnUrl);
        const result = await runAuthAction(() => authApi.appleAuthorize(state), setError);
        if (result.ok) window.location.href = result.data;
        else showToast(result.message, "error");
      }
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <div className="space-y-3">
      {withDivider ? (
        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center" aria-hidden>
            <div className="w-full border-t border-line" />
          </div>
          <p className="relative mx-auto w-fit bg-transparent px-3 text-xs font-medium text-muted">
            or continue with
          </p>
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        fullWidth
        size="lg"
        isLoading={loadingProvider === "google"}
        disabled={disabled || loadingProvider === "apple"}
        onClick={() => void start("google")}
      >
        <GoogleIcon className="size-4" aria-hidden />
        Continue with Google
      </Button>

      <Button
        type="button"
        variant="secondary"
        fullWidth
        size="lg"
        isLoading={loadingProvider === "apple"}
        disabled={disabled || loadingProvider === "google"}
        onClick={() => void start("apple")}
      >
        <AppleIcon className="size-4" aria-hidden />
        Continue with Apple
      </Button>
    </div>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.7 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44a20 20 0 0 0 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.3 0-9.7-3.4-11.3-8l-6.5 5A20 20 0 0 0 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.6l6.2 5.2c-.4.4 6.6-4.8 6.6-14.8 0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M16.365 1.43c0 1.14-.46 2.27-1.21 3.08-.81.87-2.13 1.55-3.21 1.46-.13-1.11.39-2.27 1.13-3.05.83-.88 2.25-1.55 3.29-1.49zM20.94 17.32c-.6 1.32-.9 1.92-1.66 3.08-1.07 1.62-2.59 3.64-4.47 3.66-1.67.02-2.1-1.09-4.37-1.08-2.27.02-2.75 1.1-4.42 1.07-1.88-.02-3.31-1.85-4.38-3.47C-1.31 17.39-1.61 11.84.65 8.91 2.26 6.83 4.78 5.6 7.16 5.6c2.42 0 3.94 1.34 5.95 1.34 1.95 0 3.13-1.34 5.93-1.34 2.12 0 4.36 1.16 5.96 3.16-5.24 2.87-4.39 10.36.07 8.56z" />
    </svg>
  );
}
