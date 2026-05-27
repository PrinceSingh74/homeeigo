"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Wrench,
  CalendarCheck,
  CreditCard,
  BarChart3,
  Bot,
  ShieldAlert,
  Settings,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/cn";

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/vendors", label: "Vendors", icon: Wrench },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/ai", label: "AI Systems", icon: Bot },
  { href: "/fraud", label: "Fraud", icon: ShieldAlert },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="biz-sidebar hidden w-60 shrink-0 flex-col lg:flex xl:w-64">
      <div className="border-b border-[var(--color-biz-line)] px-5 py-5">
        <div className="flex items-center gap-2">
          <Building2 className="h-6 w-6 text-[var(--color-biz-accent)]" />
          <div>
            <p className="text-sm font-bold tracking-tight">HOMIGO</p>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--color-biz-accent)]">
              Business HQ
            </p>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-[var(--color-biz-muted)]">
          Company operations — not partner app
        </p>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {nav.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                active
                  ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                  : "text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)] hover:text-[var(--color-biz-text)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>
      <p className="border-t border-[var(--color-biz-line)] p-4 text-[10px] text-[var(--color-biz-muted)]">
        admin.homigo.com · Port 3003
      </p>
    </aside>
  );
}
