import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  aiSectionHeaderMeta,
  aiSectionHeaderRow,
  aiSectionSubtitle,
  aiSectionTitle,
} from "@/components/ai/ai-page-layout";

type AiSectionHeaderProps = {
  title: string;
  subtitle?: string;
  meta?: string;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function AiSectionHeader({
  title,
  subtitle,
  meta,
  badge,
  action,
  className,
}: AiSectionHeaderProps) {
  return (
    <header className={cn(aiSectionHeaderRow, className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className={aiSectionTitle}>{title}</h2>
          {badge}
        </div>
        {subtitle && <p className={aiSectionSubtitle}>{subtitle}</p>}
      </div>
      {(meta || action) && (
        <div className={aiSectionHeaderMeta}>
          {meta && (
            <span className="text-[11px] font-medium text-slate dark:text-slate-400">{meta}</span>
          )}
          {action}
        </div>
      )}
    </header>
  );
}
