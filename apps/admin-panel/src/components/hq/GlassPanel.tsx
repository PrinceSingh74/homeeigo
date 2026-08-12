import { memo, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export const GlassPanel = memo(function GlassPanel({
  children,
  className,
  glow,
}: {
  children: ReactNode;
  className?: string;
  glow?: "amber" | "blue" | "emerald" | "red" | "none";
}) {
  return (
    <div
      className={cn(
        "biz-glass-panel",
        glow === "amber" && "biz-glass-glow-amber",
        glow === "blue" && "biz-glass-glow-blue",
        glow === "emerald" && "biz-glass-glow-emerald",
        glow === "red" && "biz-glass-glow-red",
        className,
      )}
    >
      {children}
    </div>
  );
});
