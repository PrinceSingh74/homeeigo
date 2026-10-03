"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant =
  | "primary"
  | "secondary"
  | "ghost"
  | "inverse"
  | "danger"
  /** @deprecated resolves to secondary */
  | "outline"
  /** @deprecated resolves to secondary */
  | "glass"
  /** @deprecated resolves to primary */
  | "success"
  /** @deprecated resolves to primary */
  | "gold"
  /** @deprecated resolves to inverse */
  | "dark";
type Size = "sm" | "md" | "lg" | "xl";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
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
  "select-none whitespace-nowrap rounded-xl outline-none " +
  "transition-[color,background-color,border-color,box-shadow,transform] duration-200 " +
  "focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50";

/**
 * HOMEEIGO button system - exactly five visual styles:
 *   primary   filled brand gradient (the one call-to-action per surface)
 *   secondary glass + hairline, brand text (supporting CTA on light surfaces)
 *   ghost     borderless, content text (tertiary / toolbar actions)
 *   inverse   solid white, brand text (CTA on dark / gradient banners)
 *   danger    filled error (destructive)
 * Legacy variant names stay accepted but resolve to one of the five styles so
 * no caller breaks and no sixth style can appear.
 */
const STYLE = {
  primary:
    "bg-brand-gradient text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_8px_24px_-6px_rgb(16_185_129/0.5)] " +
    "hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.35),0_14px_36px_-8px_rgb(16_185_129/0.6)]",
  secondary:
    "glass-card border border-emerald-500/25 text-brand shadow-e2 " +
    "hover:border-emerald-500/45 hover:shadow-e3 dark:border-white/12",
  ghost: "bg-transparent text-content hover:bg-content/5",
  inverse:
    "bg-white text-brand shadow-e3 hover:shadow-e4 dark:bg-white dark:text-emerald-800",
  danger: "bg-error text-white shadow-e3 hover:opacity-90",
} as const;

export const buttonVariants: Record<Variant, string> = {
  primary: STYLE.primary,
  secondary: STYLE.secondary,
  ghost: STYLE.ghost,
  inverse: STYLE.inverse,
  danger: STYLE.danger,
  // ---- legacy aliases (kept for API compatibility) ----
  outline: STYLE.secondary,
  glass: STYLE.secondary,
  success: STYLE.primary,
  gold: STYLE.primary,
  dark: STYLE.inverse,
};

/** One height/type/padding rule per size - shared by Button + ButtonLink. */
export const buttonSizes: Record<Size, string> = {
  sm: "h-9 min-h-[44px] px-4 text-sm sm:min-h-9 sm:h-9",
  md: "h-11 min-h-[44px] px-5 text-sm",
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
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        buttonBase,
        "enabled:hover:scale-[1.02] enabled:active:scale-[0.96] motion-reduce:transform-none",
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
    </button>
  ),
);
Button.displayName = "Button";
