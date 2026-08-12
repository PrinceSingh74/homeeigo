"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { m as motion } from "framer-motion";
import { Bell } from "lucide-react";
import { IconButton } from "@/components/buttons/IconButton";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocationButton } from "@/components/LocationButton";
import { NotificationBadge } from "@/components/ui/NotificationBadge";
import { useAppStore } from "@/stores/app-store";
import { MAIN_NAV_ITEMS, isMainNavActive } from "@/lib/main-nav";
import { cn } from "@/lib/utils";

const NAVBAR_HEIGHT = "3.5rem";

function navLinkClass(active: boolean) {
  return active
    ? "rounded-full bg-primary/10 px-3 py-2 text-sm font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:px-4"
    : "rounded-full px-3 py-2 text-sm font-semibold text-content transition-colors hover:bg-primary/5 hover:text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/60 xl:px-4";
}

export function Navbar() {
  const pathname = usePathname();
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <motion.header
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50 w-full border-b border-white/55 glass dark:glass-dark dark:border-white/10 shadow-e2 pt-[env(safe-area-inset-top,0px)] backdrop-saturate-200"
      style={{ ["--navbar-h" as string]: NAVBAR_HEIGHT }}
    >
      <nav
        className={cn(
          "mx-auto grid w-full min-w-0 max-w-content items-center gap-2",
          "h-[var(--navbar-h)] min-h-[var(--navbar-h)]",
          "grid-cols-[minmax(0,auto)_1fr] lg:grid-cols-[auto_1fr_auto]",
          "px-[max(0.75rem,env(safe-area-inset-left,0px))]",
          "pr-[max(0.75rem,env(safe-area-inset-right,0px))]",
          "sm:gap-3 sm:px-4 md:px-6",
        )}
        aria-label="Site"
      >
        {/* Logo */}
        <Link
          href="/"
          className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:gap-2"
          aria-label="HOMEEIGO home"
        >
          {/* Light artwork on light UI; light-wordmark variant in night mode. */}
          <Image
            src="/brand/logo-full.png"
            alt="Homeeigo"
            width={560}
            height={386}
            priority
            className="h-10 w-[58px] shrink-0 object-contain sm:h-11 sm:w-16 dark:hidden"
          />
          <Image
            src="/brand/logo-full-dark.png"
            alt="Homeeigo"
            width={560}
            height={386}
            priority
            className="hidden h-10 w-[58px] shrink-0 object-contain sm:h-11 sm:w-16 dark:block"
          />
        </Link>

        {/* Desktop main links */}
        <nav
          className="hidden min-w-0 items-center justify-center gap-0.5 lg:flex xl:gap-1"
          aria-label="Main"
        >
          {MAIN_NAV_ITEMS.map((item) => {
            const active = isMainNavActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap",
                  navLinkClass(active),
                )}
              >
                {item.label}
                {item.badge ? (
                  <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        {/* Actions — never overflow on small screens */}
        <div
          className={cn(
            "col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-0.5 sm:gap-1 md:gap-2",
            "lg:col-start-3",
          )}
        >
          <LocationButton compact className="min-w-0" />

          <ThemeToggle size={36} className="sm:hidden" />
          <ThemeToggle size={40} className="hidden sm:flex" />

          <IconButton
            label="Notifications"
            size={36}
            className="relative shrink-0 sm:hidden"
            onClick={() => openOverlay("notifications")}
          >
            <Bell size={18} />
            <NotificationBadge size="sm" />
          </IconButton>

          <IconButton
            label="Notifications"
            size={40}
            className="relative hidden shrink-0 sm:flex"
            onClick={() => openOverlay("notifications")}
          >
            <Bell size={20} />
            <NotificationBadge />
          </IconButton>

          <Link
            href="/profile"
            aria-label="Open profile"
            className="ml-0.5 shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 rounded-full"
          >
            <motion.span
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              className="grid size-9 place-items-center rounded-full bg-premium text-xs font-bold text-white ring-2 ring-primary shadow-[0_0_12px_rgb(37_99_235/0.25)] sm:size-10 sm:text-sm"
            >
              A
            </motion.span>
          </Link>
        </div>
      </nav>
    </motion.header>
  );
}

// Re-export for backwards compatibility; canonical home is `navbar-constants.ts`
// (importing the constant must not drag the full Navbar module into first-load bundles).
export { NAVBAR_OFFSET } from "@/components/navbar-constants";
