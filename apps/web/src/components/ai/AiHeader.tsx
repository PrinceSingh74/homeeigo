"use client";

import Image from "next/image";
import Link from "next/link";
import { Bell, Mic, Sparkles } from "lucide-react";
import { m as motion } from "framer-motion";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import { AI_USER } from "@/lib/ai-dashboard";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { NotificationBadge } from "@/components/ui/NotificationBadge";
import { useAppStore } from "@/stores/app-store";
import { slideHeader } from "@/components/ai/ai-motion";

/**
 * Mobile-only AI toolbar. Desktop uses site Navbar (top); mobile uses BottomNav + this bar.
 */
export function AiHeader() {
  const { toggleVoiceModeWithFeedback, voiceMode } = useAiPageActions();
  const openOverlay = useAppStore((s) => s.openOverlay);

  return (
    <motion.header
      variants={slideHeader}
      initial="hidden"
      animate="show"
      className={cn(
        "ai-unified-nav fixed left-0 right-0 top-0 z-40 w-full pt-[env(safe-area-inset-top,0px)] lg:hidden",
      )}
    >
      <div
        className={cn(
          "ai-header-glass flex min-h-[3.25rem] items-center justify-between gap-1 border-b px-2.5 py-1.5",
          "sm:min-h-14 sm:gap-2 sm:px-4 sm:py-2",
        )}
      >
        <Link
          href="/ai"
          className="flex min-w-0 max-w-[48%] shrink-0 items-center gap-2 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet/50 sm:max-w-none sm:gap-2.5"
          aria-label="HOMEEIGO AI"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 via-teal-500 to-emerald-600 text-white shadow-[0_4px_16px_rgb(16_185_129/0.35)]">
            <Sparkles size={16} />
          </span>
          <span className="flex min-w-0 flex-col leading-none">
            <span className="font-display text-sm font-bold tracking-tight text-ink dark:text-slate-100">
              HOMEEIGO
              <span className="ml-1 bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                AI
              </span>
            </span>
            <span className="mt-0.5 hidden truncate text-[10px] font-medium text-slate/90 min-[380px]:block">
              Your Home Intelligence
            </span>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1.5">
          <span className="inline-flex scale-90 sm:scale-100">
            <ThemeToggle />
          </span>

          <button
            type="button"
            onClick={toggleVoiceModeWithFeedback}
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-full text-white shadow-[0_4px_14px_rgb(16_185_129/0.4)] transition hover:scale-[1.02]",
              voiceMode
                ? "bg-ink ring-2 ring-emerald-500/40"
                : "bg-gradient-to-r from-emerald-500 to-teal-500",
            )}
            aria-label="Voice mode"
          >
            <Mic size={16} />
          </button>

          <button
            type="button"
            aria-label="Notifications"
            onClick={() => openOverlay("notifications")}
            className="relative grid size-8 place-items-center rounded-full text-ink transition hover:bg-white/10 dark:text-slate-100 dark:hover:bg-white/10 sm:size-10"
          >
            <Bell size={18} className="sm:hidden" />
            <Bell size={20} className="hidden sm:block" />
            <NotificationBadge />
          </button>

          <button
            type="button"
            onClick={() => openOverlay("profile")}
            className="flex items-center rounded-full p-0.5 transition hover:bg-white/10 dark:hover:bg-white/10"
            aria-label={AI_USER.name}
          >
            <span className="relative size-8 overflow-hidden rounded-full border-2 border-white shadow-[0_2px_12px_rgb(0_0_0/0.12)] dark:border-slate-600 sm:size-10">
              <Image src={AI_USER.avatar} alt="" fill className="object-cover" sizes="40px" />
            </span>
          </button>
        </div>
      </div>
    </motion.header>
  );
}
