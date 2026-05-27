"use client";

import { Bell, Search } from "lucide-react";
import { useAdminStore } from "@/stores/admin-store";
import { ADMIN_KPIS } from "@/lib/admin-data";

export function AdminTopBar() {
  const name = useAdminStore((s) => s.adminName);

  return (
    <header className="flex items-center justify-between border-b border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] px-4 py-3 md:px-6">
      <div className="relative max-w-md flex-1">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-muted)]" />
        <input
          type="search"
          placeholder="Search bookings, vendors, customers…"
          className="w-full rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
        />
      </div>
      <div className="ml-4 flex items-center gap-3">
        {ADMIN_KPIS.fraudFlags > 0 && (
          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-400">
            {ADMIN_KPIS.fraudFlags} alerts
          </span>
        )}
        <button
          type="button"
          className="rounded-lg p-2 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]"
          aria-label="Notifications"
        >
          <Bell className="h-5 w-5" />
        </button>
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium">{name}</p>
          <p className="text-[10px] text-[var(--color-biz-muted)]">Super Admin</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-biz-accent-dim)] text-sm font-bold text-[var(--color-biz-accent)]">
          {name.charAt(0)}
        </div>
      </div>
    </header>
  );
}
