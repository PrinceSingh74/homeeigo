"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "success" | "ghost" | "danger" | "outline";

const variants: Record<Variant, string> = {
  primary:
    "bg-partner-primary text-white partner-glow-btn hover:bg-blue-600",
  success: "bg-partner-success text-white partner-glow-btn hover:bg-green-600",
  ghost: "bg-transparent text-partner-text hover:bg-white/5",
  danger: "bg-partner-danger/90 text-white hover:bg-red-600",
  outline:
    "border border-partner-line bg-transparent text-partner-text hover:border-partner-primary/50",
};

export function PartnerButton({
  variant = "primary",
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-50",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
