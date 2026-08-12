"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Plus, Sparkles, User } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import { useProfileDerived } from "@/hooks/use-derived-selectors";
import { bookUrl } from "@/lib/booking-url";
import { NotificationBadge } from "@/components/ui/NotificationBadge";
import { useAppStore } from "@/stores/app-store";

/** Mobile/tablet only — desktop uses site Navbar. */
export function ProfileTopBar() {
  const router = useRouter();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const { profileUser } = useProfileDerived();

  return (
    <header
      className={cn(
        "profile-topbar z-30 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line glass dark:glass-dark",
        "pt-[env(safe-area-inset-top,0px)]",
        "sm:h-14 sm:gap-3 sm:px-4",
        "lg:hidden",
      )}
    >
      <Link
        href="/"
        className="flex min-w-0 shrink-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        aria-label="HOMEEIGO home"
      >
        <span className="grid size-8 place-items-center rounded-lg bg-[linear-gradient(135deg,#10b981_0%,#0d9488_100%)] text-white shadow-[0_8px_24px_-6px_rgb(16_185_129/0.5)]">
          <Sparkles size={16} />
        </span>
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate font-display text-sm font-bold tracking-tight text-content">
            HOMEEIGO
          </span>
          <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
            <User size={10} />
            Profile
          </span>
        </span>
      </Link>

      <div className="mx-2 hidden min-w-0 max-w-[220px] flex-1 min-[480px]:block">
        <Input
          type="search"
          variant="search"
          size="sm"
          placeholder="Search…"
          showClear={false}
          aria-label="Search profile"
          containerClassName="h-9 min-h-9 rounded-full border-line bg-surface/80 shadow-none"
          onFocus={() =>
            showToast("Profile search — bookings & settings soon", "info")
          }
        />
      </div>

      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
        <ThemeToggle size={36} className="sm:hidden" />
        <ThemeToggle size={40} className="hidden sm:flex" />

        <button
          type="button"
          onClick={() => router.push(bookUrl())}
          className="hidden h-9 items-center gap-1.5 rounded-full bg-emerald-600 px-3 text-xs font-semibold text-white shadow-[0_8px_24px_-6px_rgb(16_185_129/0.5)] min-[420px]:flex"
        >
          <Plus size={14} strokeWidth={2.5} />
          Book
        </button>

        <button
          type="button"
          aria-label="Notifications"
          onClick={() => openOverlay("notifications")}
          className="relative grid size-9 place-items-center rounded-full text-content transition hover:bg-emerald-600/5 sm:size-10"
        >
          <Bell size={18} />
          <NotificationBadge size="sm" />
        </button>

        <button
          type="button"
          onClick={() => openOverlay("profile")}
          aria-label={profileUser.name}
          className="rounded-full p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60"
        >
          <Image
            src={profileUser.avatar}
            alt=""
            width={40}
            height={40}
            className="size-9 rounded-full border-2 border-line object-cover sm:size-10"
          />
        </button>
      </div>
    </header>
  );
}
