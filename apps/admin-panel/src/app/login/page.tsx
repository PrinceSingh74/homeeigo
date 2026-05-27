"use client";

import { useRouter } from "next/navigation";
import { Building2, Lock } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";

export default function AdminLoginPage() {
  const setAuthenticated = useAdminStore((s) => s.setAuthenticated);
  const router = useRouter();

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Building2 className="mx-auto h-10 w-10 text-[var(--color-biz-accent)]" />
          <h1 className="mt-4 text-2xl font-bold">HOMIGO Business HQ</h1>
          <p className="mt-2 text-sm text-[var(--color-biz-muted)]">
            Poora business yahan manage hota hai — vendors, payments, fraud, AI
          </p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
            Ye partner app (3002) ya customer site (3001) nahi hai
          </p>
        </div>
        <div className="biz-card space-y-4 p-6">
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]">Admin email</label>
            <input
              type="email"
              defaultValue="ops@homigo.com"
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-biz-accent)]"
            />
          </div>
          <div>
            <label className="text-xs text-[var(--color-biz-muted)]">Password</label>
            <input
              type="password"
              defaultValue="••••••••"
              className="mt-1 w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-biz-accent)]"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setAuthenticated(true);
              router.replace("/");
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--color-biz-accent)] py-2.5 text-sm font-semibold text-black transition hover:opacity-90"
          >
            <Lock className="h-4 w-4" />
            Enter Business HQ
          </button>
        </div>
      </div>
    </div>
  );
}
