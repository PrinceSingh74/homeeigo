import { cn } from "@/lib/cn";

export function StatPill({
  label,
  value,
  trend,
  className,
}: {
  label: string;
  value: string;
  trend?: "up" | "down";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="text-xs text-partner-muted">{label}</span>
      <span className="font-display text-lg font-semibold tracking-tight">
        {value}
        {trend && (
          <span
            className={cn(
              "ml-1 text-xs font-normal",
              trend === "up" ? "text-partner-success" : "text-partner-danger"
            )}
          >
            {trend === "up" ? "↑" : "↓"}
          </span>
        )}
      </span>
    </div>
  );
}
