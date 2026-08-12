"use client";

import { FormEvent, useRef } from "react";
import { Home, ImageIcon, Mic, Paperclip } from "lucide-react";
import { m as motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/Input";
import { useAiPageActions } from "@/hooks/use-ai-page-actions";
import { useAiStore } from "@/stores/ai-store";
import Link from "next/link";

export function AiFloatingInputBar() {
  const draft = useAiStore((s) => s.draft);
  const setDraft = useAiStore((s) => s.setDraft);
  const sendMessage = useAiStore((s) => s.sendMessage);
  const {
    toggleVoiceCapture,
    onAttachFile,
    onFloatingImageUpload,
    isRecording,
    voiceMode,
  } = useAiPageActions();
  const fileRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(draft);
  };

  const attachControl = (
    <button
      type="button"
      aria-label="Attach file"
      onClick={onAttachFile}
      className="grid size-8 shrink-0 place-items-center text-[#9CA3AF] transition hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300"
    >
      <Paperclip size={16} />
    </button>
  );

  const trailingControls = (
    <span className="flex shrink-0 items-center gap-0.5 sm:gap-1">
      <button
        type="button"
        aria-label="Upload image"
        onClick={() => fileRef.current?.click()}
        className="grid size-8 shrink-0 place-items-center text-[#9CA3AF] transition hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300"
      >
        <ImageIcon size={17} className="sm:hidden" />
        <ImageIcon size={18} className="hidden sm:block" />
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFloatingImageUpload(file);
          e.target.value = "";
        }}
      />
      <Link
        href="/"
        aria-label="Home"
        className="hidden shrink-0 p-1 text-[#9CA3AF] transition hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-300 sm:block"
      >
        <Home size={18} />
      </Link>
    </span>
  );

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-40",
        "bottom-0 max-lg:bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))]",
        "ai-input-glass border-t",
        "px-3 py-2.5 sm:px-6 sm:py-3 lg:px-8",
        voiceMode && "ring-2 ring-inset ring-violet/20",
      )}
      style={{
        paddingBottom: "max(0.625rem, env(safe-area-inset-bottom, 0px))",
      }}
    >
      <form
        onSubmit={onSubmit}
        className="mx-auto flex w-full max-w-[1440px] min-w-0 items-center gap-2 sm:gap-3"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask me anything..."
          iconLeft={attachControl}
          iconRight={trailingControls}
          showClear={false}
          size="md"
          className="min-w-0 flex-1"
          containerClassName={cn(
            "ai-input-inner h-11 gap-1.5 rounded-2xl border-[#E5E7EB] bg-[#F9FAFB] px-1 shadow-none sm:h-12 sm:gap-2 sm:px-2",
            "focus-within:border-primary focus-within:bg-white focus-within:shadow-[0_4px_12px_rgb(37_99_235/0.1)]",
            "dark:border-slate-600 dark:bg-slate-900/80 dark:focus-within:bg-slate-900",
          )}
          inputClassName="text-sm text-ink placeholder:text-[#9CA3AF] dark:text-slate-100 dark:placeholder:text-slate-500"
          aria-label="Message to HOMEEIGO AI"
        />

        <motion.button
          type="button"
          aria-label={isRecording ? "Stop recording" : "Voice input"}
          onClick={toggleVoiceCapture}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          className={cn(
            "grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-[0_4px_12px_rgb(16_185_129/0.35)] sm:size-12",
            isRecording && "animate-pulse ring-2 ring-emerald-400/50",
          )}
        >
          <Mic size={20} />
        </motion.button>
      </form>
    </div>
  );
}
