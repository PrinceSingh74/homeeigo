"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Building2, Loader2, Lock } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";

export default function AdminLoginPage() {
  const login = useAdminStore((s) => s.login);
  const storeError = useAdminStore((s) => s.error);
  const setError = useAdminStore((s) => s.setError);
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLocalError(null);
    setError(null);
    if (!email || !password) {
      setLocalError("Email and password are required");
      return;
    }
    setIsLoading(true);
    const result = await login(email.trim().toLowerCase(), password);
    setIsLoading(false);
    if (result.ok) {
      router.replace("/");
    } else {
      setLocalError(result.message);
    }
  }

  const errorToShow = localError || storeError;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-[var(--color-biz-accent)]" />
          <h1 className="mt-4 text-2xl font-bold">HOMEEIGO Business HQ</h1>
          <p className="mt-2 text-sm text-[var(--color-biz-muted)]">
            Internal operations console — admin role required
          </p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            Not the partner app (3002) or customer site (3001)
          </p>
        </div>

        <div className="biz-card space-y-4 p-6">
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="admin-email">
              Admin email
            </label>
            <input
              id="admin-email"
              type="email"
              autoComplete="email"
              required
              disabled={isLoading}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]" htmlFor="admin-password">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              required
              disabled={isLoading}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-biz-accent)] disabled:opacity-60"
            />
          </div>

          {errorToShow ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorToShow}</span>
            </div>
          ) : null}

          <button
            type="submit"
            disabled={isLoading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-biz-accent)] py-2.5 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {isLoading ? "Signing you in…" : "Enter Business HQ"}
          </button>

          <p className="text-center text-[10px] text-[var(--color-biz-muted)]">
            Admins are issued credentials by the platform team — no public signup.
          </p>
        </div>
      </form>
    </div>
  );
}
