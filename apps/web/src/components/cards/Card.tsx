import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant =
  | "default"
  | "surface"
  | "bordered"
  | "elevated"
  | "interactive"
  | "glass"
  | "gradient";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: Variant;
}

const variants: Record<Variant, string> = {
  default: "glass-card border border-white/55 shadow-e3 dark:border-white/10",
  surface: "glass-card border border-white/55 shadow-e3 dark:border-white/10",
  bordered: "glass-card border-2 border-white/70 shadow-e1 dark:border-white/15",
  elevated: "glass-card border border-white/60 shadow-e4 dark:border-white/12",
  interactive:
    "glass-card border border-white/55 shadow-e3 dark:border-white/10 cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-e4",
  glass: "glass dark:glass-dark border border-line/50 shadow-e2",
  gradient: "bg-aurora text-white shadow-glow-blue border-0",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ variant = "default", className, children, ...props }, ref) => {
    const resolved = variant === "surface" ? "default" : variant;
    return (
      <div
        ref={ref}
        className={cn(
          "rounded-3xl p-4 transition-all duration-300 sm:p-6",
          variants[resolved],
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Card.displayName = "Card";
