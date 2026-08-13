import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LegalPillTone = "positive" | "caution" | "info";

const TONE_DOT: Record<LegalPillTone, string> = {
  positive: "bg-success",
  caution: "bg-warning",
  info: "bg-emerald-600",
};

/**
 * Status pill for the legal data tables.
 *
 * The colour lives in the dot and the label stays `text-content`. Tinted label
 * text at these weights and sizes (amber-600 / emerald-600 on a light surface)
 * sits near 3:1 and misses WCAG AA for body text, and colour alone is not a
 * safe carrier of meaning — the written value does that job here.
 */
export function LegalStatusPill({
  tone,
  children,
}: {
  tone: LegalPillTone;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-content">
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}
