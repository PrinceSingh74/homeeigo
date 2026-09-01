"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { COMMAND_CENTER_SURFACES } from "@/lib/command-center-ia";
import { cn } from "@/lib/cn";

export function CommandCenterRail() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Partner Command Center"
      className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      tabIndex={0}
    >
      {COMMAND_CENTER_SURFACES.map((surface) => {
        const active =
          surface.href === "/command-center"
            ? pathname === "/command-center"
            : pathname === surface.href || pathname.startsWith(`${surface.href}/`);
        return (
          <Link
            key={surface.id}
            href={surface.href}
            title={surface.description}
            className={cn(
              "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold tracking-wide transition",
              active
                ? "border-[var(--color-biz-accent)] bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-text)]"
                : "border-[var(--color-biz-line)] text-[var(--color-biz-muted)] hover:border-[var(--color-biz-accent)]/40 hover:text-[var(--color-biz-text)]",
            )}
          >
            {surface.label}
          </Link>
        );
      })}
    </nav>
  );
}
