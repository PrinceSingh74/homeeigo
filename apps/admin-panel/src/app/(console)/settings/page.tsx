"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, ShieldCheck, User2 } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";

export default function SettingsPage() {
  const logout = useAdminStore((s) => s.logout);
  const user = useAdminStore((s) => s.user);
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Account, session, commission &amp; notification preferences
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="biz-card space-y-4 p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]">
              <User2 className="h-5 w-5" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {user
                  ? `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email
                  : "Admin"}
              </p>
              <p className="text-xs text-[var(--color-biz-muted)]">
                {user?.email ?? "—"} · Role {user?.role ?? "—"}
              </p>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-3">
              <dt className="text-[var(--color-biz-muted)]">Email verified</dt>
              <dd className="mt-1 font-medium">
                {user?.isEmailVerified ? "Yes" : "No"}
              </dd>
            </div>
            <div className="rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-3">
              <dt className="text-[var(--color-biz-muted)]">Phone verified</dt>
              <dd className="mt-1 font-medium">
                {user?.isPhoneVerified ? "Yes" : "No"}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={isSigningOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 py-2.5 text-sm font-semibold text-red-300 transition hover:bg-red-500/15 disabled:opacity-60"
          >
            {isSigningOut ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogOut className="h-4 w-4" />
            )}
            {isSigningOut ? "Signing out…" : "Sign out of HOMEEIGO HQ"}
          </button>
        </div>

        <div className="biz-card space-y-4 p-6 text-sm">
          <div className="flex items-center gap-2 text-[var(--color-biz-accent)]">
            <ShieldCheck className="h-5 w-5" />
            <p className="font-semibold">Admin role active</p>
          </div>
          <p className="text-xs leading-relaxed text-[var(--color-biz-muted)]">
            All actions you take here — approving vendors, banning users, processing
            payouts — are audited and tied to your admin account. Commission rates,
            cities, AI thresholds and team access are configured via the platform
            engineering console (separate from this app).
          </p>
        </div>
      </div>
    </div>
  );
}
