"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

type Variant = "primary" | "glass" | "gold" | "ghost" | "dark";
type Size = "sm" | "md" | "lg";

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref"> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

const base =
  "relative inline-flex items-center justify-center gap-2 font-semibold " +
  "select-none whitespace-nowrap rounded-xl outline-none transition-shadow " +
  "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-aurora text-white shadow-[0_8px_24px_rgb(37_99_235/0.3)]",
  glass:
    "glass dark:glass-dark text-primary dark:text-luxe border border-line/60 " +
    "shadow-e2 hover:border-primary/30",
  gold: "bg-gold text-ink shadow-glow-gold",
  ghost: "text-content hover:bg-primary/5",
  dark: "bg-ink text-white shadow-e3 hover:bg-charcoal",
};

const sizes: Record<Size, string> = {
  sm: "h-11 px-5 text-sm",
  md: "h-12 px-6 text-[15px]",
  lg: "h-14 px-7 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = "primary", size = "lg", fullWidth, className, children, ...props },
    ref,
  ) => (
    <motion.button
      ref={ref}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 17 }}
      className={cn(
        base,
        variants[variant],
        sizes[size],
        fullWidth && "w-full",
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  ),
);
Button.displayName = "Button";
