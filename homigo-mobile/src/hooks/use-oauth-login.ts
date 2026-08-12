import { useCallback } from "react";
import * as WebBrowser from "expo-web-browser";
import {
  beginGoogleOAuth,
  claimOAuthAuthorizationCode,
  consumeGoogleOAuthPending,
  finishOAuthAuthorizationCode,
  getGoogleOAuthUserMessage,
} from "@/lib/auth/google-oauth";
import {
  beginAppleOAuth,
  claimAppleAuthorizationCode,
  consumeAppleOAuthPending,
  finishAppleAuthorizationCode,
  getAppleOAuthUserMessage,
  readAppleOAuthUserParam,
} from "@/lib/auth/apple-oauth";
import {
  getAppleOAuthRedirectUri,
  getGoogleOAuthRedirectUri,
} from "@/lib/auth/routes";
import { authApi } from "@/services/auth/auth-api";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";

WebBrowser.maybeCompleteAuthSession();

function parseOAuthResult(url: string) {
  const parsed = new URL(url);
  return {
    code: parsed.searchParams.get("code"),
    state: parsed.searchParams.get("state"),
    error: parsed.searchParams.get("error"),
  };
}

export function useOAuthLogin() {
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const setError = useAuthStore((s) => s.setError);

  const startGoogle = useCallback(
    async (returnUrl?: string) => {
      const state = await beginGoogleOAuth(returnUrl);
      const authUrl = await runAuthAction(() => authApi.googleAuthorize(state), setError);
      if (!authUrl.ok) return { ok: false as const, message: authUrl.message };

      const redirectUri = getGoogleOAuthRedirectUri();
      const result = await WebBrowser.openAuthSessionAsync(authUrl.data, redirectUri);
      if (result.type !== "success" || !result.url) {
        return { ok: false as const, message: "Google sign-in was cancelled." };
      }

      const { code, state: urlState, error } = parseOAuthResult(result.url);
      if (error) {
        return { ok: false as const, message: getGoogleOAuthUserMessage(error) };
      }
      if (!code) {
        return { ok: false as const, message: "Missing authorization code from Google." };
      }

      const pending = await consumeGoogleOAuthPending(urlState);
      if (!pending.valid) {
        return { ok: false as const, message: pending.error };
      }

      const claim = await claimOAuthAuthorizationCode(code);
      if (claim === "duplicate") {
        return { ok: true as const, returnUrl: pending.returnUrl };
      }
      if (claim === "in_flight") {
        return { ok: false as const, message: "Sign-in already in progress." };
      }

      try {
        await signInWithGoogle(code, urlState);
        await finishOAuthAuthorizationCode(code, true);
        return { ok: true as const, returnUrl: pending.returnUrl };
      } catch (error) {
        await finishOAuthAuthorizationCode(code, false);
        throw error;
      }
    },
    [setError, signInWithGoogle],
  );

  const startApple = useCallback(
    async (returnUrl?: string) => {
      const state = await beginAppleOAuth(returnUrl);
      const authUrl = await runAuthAction(() => authApi.appleAuthorize(state), setError);
      if (!authUrl.ok) return { ok: false as const, message: authUrl.message };

      const redirectUri = getAppleOAuthRedirectUri();
      const result = await WebBrowser.openAuthSessionAsync(authUrl.data, redirectUri);
      if (result.type !== "success" || !result.url) {
        return { ok: false as const, message: "Apple sign-in was cancelled." };
      }

      const { code, state: urlState, error } = parseOAuthResult(result.url);
      if (error) {
        return { ok: false as const, message: getAppleOAuthUserMessage(error) };
      }
      if (!code) {
        return { ok: false as const, message: "Missing authorization code from Apple." };
      }

      const pending = await consumeAppleOAuthPending(urlState);
      if (!pending.valid) {
        return { ok: false as const, message: pending.error };
      }

      const claim = await claimAppleAuthorizationCode(code);
      if (claim === "duplicate") {
        return { ok: true as const, returnUrl: pending.returnUrl };
      }
      if (claim === "in_flight") {
        return { ok: false as const, message: "Sign-in already in progress." };
      }

      const appleUser = await readAppleOAuthUserParam();
      try {
        await signInWithApple(code, urlState, appleUser);
        await finishAppleAuthorizationCode(code, true);
        return { ok: true as const, returnUrl: pending.returnUrl };
      } catch (err) {
        await finishAppleAuthorizationCode(code, false);
        throw err;
      }
    },
    [setError, signInWithApple],
  );

  return { startGoogle, startApple };
}
