import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "surface" | "glass" | "gradient";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  surface: "bg-surface border border-line shadow-e3",
  glass: "glass dark:glass-dark border border-line/50 shadow-e2",
  gradient: "bg-aurora text-white shadow-glow-blue border-0",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "surface", className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-3xl p-6 transition-all duration-300",
        variants[variant],
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";
