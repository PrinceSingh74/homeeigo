import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "ai" | "featured" | "neutral";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  ai: "bg-primary/10 text-primary border border-primary/15",
  featured: "bg-white text-violet shadow-e1",
  neutral: "bg-surface text-muted border border-line",
};

export function Badge({
  variant = "neutral",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5",
        "text-xs font-medium tracking-wide",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
