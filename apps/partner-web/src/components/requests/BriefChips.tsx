import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A labelled row of short facts on the execution brief ("Wear", "Materials", "Do not use" …). The
 * label word and the icon carry the meaning; the chips themselves are neutral, so nothing depends
 * on colour. Renders nothing for an empty list — a missing rule is silence, never a placeholder.
 */
export function BriefChips({
  label,
  items,
  icon: Icon,
  className,
  testId,
}: {
  label: string;
  items: readonly string[];
  icon: LucideIcon;
  className?: string;
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)} data-testid={testId}>
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-partner-text">
        <Icon className="h-3.5 w-3.5 shrink-0 text-partner-primary" aria-hidden="true" />
        {label}:
      </span>
      <ul className="contents">
        {items.map((item, i) => (
          <li
            key={`${i}:${item}`}
            className="rounded-full border border-partner-line bg-partner-bg/60 px-2.5 py-1 text-xs font-medium text-partner-text-secondary"
          >
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
