"use client";

import { forwardRef, type ReactNode } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonHover, buttonTap } from "@/lib/animations";

type Variant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "success"
  | "glass"
  | "gold"
  | "dark";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref" | "children"> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
  isLoading?: boolean;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  children?: ReactNode;
}

export const buttonBase =
  "relative inline-flex items-center justify-center gap-2 font-semibold " +
  "select-none whitespace-nowrap rounded-xl outline-none transition-colors " +
  "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50";

export const buttonVariants: Record<Variant, string> = {
  primary: "bg-aurora text-white shadow-[0_8px_24px_rgb(37_99_235/0.3)]",
  secondary:
    "glass-card text-content border border-white/65 shadow-e2 dark:border-white/12 hover:border-primary/40",
  outline:
    "border-2 border-primary/75 glass-card text-primary hover:bg-primary/8",
  ghost: "glass-card border border-white/55 text-content hover:bg-primary/8 dark:border-white/10",
  danger: "bg-error text-white shadow-e3 hover:opacity-90",
  success: "bg-success text-white shadow-e3 hover:opacity-90",
  glass:
    "glass dark:glass-dark text-primary dark:text-luxe border border-line/60 " +
    "shadow-e2 hover:border-primary/30",
  gold: "bg-gold text-ink shadow-glow-gold",
  dark: "bg-ink text-white shadow-e3 hover:bg-charcoal",
};

export const buttonSizes: Record<Size, string> = {
  sm: "h-8 min-h-[44px] px-4 text-sm sm:min-h-8 sm:h-8",
  md: "h-10 min-h-[44px] px-5 text-[15px] sm:min-h-10 sm:h-10",
  lg: "h-12 min-h-[44px] px-6 text-base",
  xl: "h-14 min-h-[44px] px-7 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      fullWidth,
      isLoading,
      icon,
      iconPosition = "left",
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => (
    <motion.button
      ref={ref}
      whileHover={disabled || isLoading ? undefined : buttonHover}
      whileTap={disabled || isLoading ? undefined : buttonTap}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        buttonBase,
        buttonVariants[variant],
        buttonSizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
      ) : null}
      {!isLoading && icon && iconPosition === "left" ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
      <span className="inline-flex items-center gap-2">{children}</span>
      {!isLoading && icon && iconPosition === "right" ? (
        <span className="shrink-0">{icon}</span>
      ) : null}
    </motion.button>
  ),
);
Button.displayName = "Button";
