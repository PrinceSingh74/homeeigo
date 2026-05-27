"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { memo } from "react";
import { motion } from "framer-motion";
import { MAIN_NAV_ITEMS, isMainNavActive } from "@/lib/main-nav";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

function BottomNavInner() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-white/55 glass dark:glass-dark dark:border-white/10 shadow-[0_-8px_24px_rgb(0_0_0/0.10)] backdrop-saturate-200 lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="mx-auto flex h-[4.5rem] max-w-content items-stretch justify-between gap-0 px-1 sm:px-2">
        {MAIN_NAV_ITEMS.map((item) => (
          <NavItem
            key={item.href}
            icon={item.icon}
            label={item.shortLabel ?? item.label}
            href={item.href}
            active={isMainNavActive(pathname, item.href)}
          />
        ))}
      </div>
    </nav>
  );
}

export const BottomNav = memo(BottomNavInner);

const NavItem = memo(function NavItem({
  icon: Icon,
  label,
  href,
  active,
}: {
  icon: LucideIcon;
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1 outline-none",
        "transition-colors focus-visible:ring-2 focus-visible:ring-primary/60",
        active ? "text-primary" : "text-muted hover:text-content",
      )}
    >
      <motion.span whileTap={{ scale: 1.15 }} transition={{ duration: 0.2 }}>
        <Icon size={20} strokeWidth={active ? 2.4 : 1.9} />
      </motion.span>
      <span
        className={cn(
          "max-w-full truncate px-0.5 text-[9px] leading-tight sm:text-[10px]",
          active && "font-bold",
        )}
      >
        {label}
      </span>
    </Link>
  );
});
