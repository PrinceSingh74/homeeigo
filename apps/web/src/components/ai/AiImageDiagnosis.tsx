"use client";

import { useCallback, useRef, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { aiGlassPanel, aiSectionShell, aiSectionTitle } from "@/components/ai/ai-page-layout";

export function AiImageDiagnosis() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [scanning, setScanning] = useState(false);
  const showToast = useAppStore((s) => s.showToast);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const file = files[0];
      if (!file.type.startsWith("image/")) {
        showToast("Please upload a JPG or PNG image", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        showToast("Image must be under 10MB", "error");
        return;
      }
      setScanning(true);
      window.setTimeout(() => {
        setScanning(false);
        showToast("AI diagnosis complete — possible AC airflow issue detected", "success");
      }, 2200);
    },
    [showToast],
  );

  return (
    <section
      id={AI_SECTION_IDS.diagnosis}
      className={cn(aiSectionShell, "scroll-mt-24 p-3.5 sm:p-6 lg:p-8")}
    >
      <h2 className={aiSectionTitle}>AI Image Diagnosis</h2>

      <input
        id="ai-diagnosis-file-input"
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />

      <motion.button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files);
        }}
        whileHover={{ scale: 1.01 }}
        className={cn(
          "ai-diagnosis-zone mt-3 flex h-[min(44vw,200px)] min-h-[168px] w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed transition sm:mt-4 sm:h-[220px] sm:gap-3 lg:h-[240px]",
          aiGlassPanel,
          "bg-gradient-to-br from-[#F0F9FF]/80 to-[#F0FDF4]/80",
          dragging && "is-dragging scale-[1.02] border-violet bg-[#EFF6FF]",
          !dragging &&
            "border-[#DBEAFE] hover:border-primary hover:shadow-[0_8px_20px_rgb(37_99_235/0.1)]",
          scanning && "animate-pulse border-primary",
        )}
      >
        {scanning ? (
          <Loader2 size={48} className="animate-spin text-primary" />
        ) : (
          <Cloud size={48} className="text-primary opacity-80" />
        )}
        <span className="font-display text-base font-bold tracking-tight text-ink">
          Upload image of the issue
        </span>
        <span className="text-[13px] text-slate">Drag & drop or click to upload</span>
        <span className="text-[11px] text-[#9CA3AF] dark:text-slate-500">JPG, PNG up to 10MB</span>
      </motion.button>
    </section>
  );
}
