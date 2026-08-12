"use client";

import { useAuthStore } from "@/stores/auth-store";

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const status = useAuthStore((s) => s.status);
  const error = useAuthStore((s) => s.error);
  const isAuthenticated = status === "authenticated";
  const isInitializing = status === "initializing" || status === "idle";
  const isLoading = status === "initializing";

  return {
    user,
    status,
    error,
    isAuthenticated,
    isInitializing,
    isLoading,
    login: useAuthStore((s) => s.login),
    signInWithGoogle: useAuthStore((s) => s.signInWithGoogle),
    signInWithApple: useAuthStore((s) => s.signInWithApple),
    logout: useAuthStore((s) => s.logout),
    register: useAuthStore((s) => s.register),
    sendOtp: useAuthStore((s) => s.sendOtp),
    verifyOtp: useAuthStore((s) => s.verifyOtp),
    forgotPassword: useAuthStore((s) => s.forgotPassword),
    resetPassword: useAuthStore((s) => s.resetPassword),
    setError: useAuthStore((s) => s.setError),
    clearSession: useAuthStore((s) => s.clearSession),
  };
}
