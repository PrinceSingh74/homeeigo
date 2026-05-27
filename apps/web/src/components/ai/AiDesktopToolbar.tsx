"use client";

import { Mic, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";

/** Desktop-only AI actions row (main nav is in site Navbar). */
export function AiDesktopToolbar() {
  const { toggleVoiceModeWithFeedback, voiceMode } = useAiPageActions();

  return (
    <div
      className={cn(
        "mb-4 hidden w-full min-w-0 shrink-0 items-center justify-between gap-4 rounded-2xl border border-white/60 p-4 dark:border-indigo-500/20 lg:flex",
        "ai-glass-panel",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet via-primary to-cyan text-white shadow-[0_4px_16px_rgb(37_99_235/0.35)]">
          <Sparkles size={18} />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-bold tracking-tight text-ink dark:text-slate-100">
            HOMIGO AI
          </p>
          <p className="text-sm text-slate dark:text-slate-400">
            Your Home. Your Intelligence. Perfect Together.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={toggleVoiceModeWithFeedback}
        className={cn(
          "inline-flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_14px_rgb(124_58_237/0.35)] transition hover:scale-[1.02]",
          voiceMode
            ? "bg-ink ring-2 ring-violet/40"
            : "bg-gradient-to-r from-violet to-pink",
        )}
      >
        <Mic size={18} />
        Voice Mode
      </button>
    </div>
  );
}
