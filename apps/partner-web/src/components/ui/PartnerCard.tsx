import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function PartnerCard({
  className,
  hover = true,
  glass = false,
  padded = true,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  hover?: boolean;
  glass?: boolean;
  padded?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl",
        padded && "p-6",
        glass ? "partner-glass" : "partner-card",
        hover && "partner-card-hover",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
