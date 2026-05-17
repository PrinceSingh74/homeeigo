"use client";

import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";

export interface IconButtonProps
  extends Omit<HTMLMotionProps<"button">, "ref"> {
  label: string;
  size?: number;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, size = 40, className, children, style, ...props }, ref) => (
    <motion.button
      ref={ref}
      type="button"
      aria-label={label}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: "spring", stiffness: 400, damping: 15 }}
      style={{ width: size, height: size, ...style }}
      className={cn(
        "relative inline-flex items-center justify-center rounded-full",
        "text-content/70 hover:text-primary",
        "outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        "transition-colors",
        className,
      )}
      {...props}
    >
      {children}
    </motion.button>
  ),
);
IconButton.displayName = "IconButton";
