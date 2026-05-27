"use client";

import { useRouter } from "next/navigation";
import { useAdminStore } from "@/stores/admin-store";

export default function SettingsPage() {
  const setAuthenticated = useAdminStore((s) => s.setAuthenticated);
  const router = useRouter();

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-[var(--color-biz-muted)]">
          Team access, cities, commission, notifications
        </p>
      </div>
      <div className="biz-card max-w-md space-y-4 p-6">
        <p className="text-sm text-[var(--color-biz-muted)]">Demo admin session</p>
        <button
          type="button"
          onClick={() => {
            setAuthenticated(false);
            router.push("/login");
          }}
          className="w-full rounded-lg border border-[var(--color-biz-line)] py-2.5 text-sm font-medium hover:bg-[var(--color-biz-elevated)]"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
