"use client";

import { cn } from "@/lib/cn";

type CircularProgressProps = {
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

export function CircularProgress({
  value,
  size = 60,
  strokeWidth = 5,
  className,
  color = "#22c55e",
  trackColor = "rgba(34, 197, 94, 0.15)",
  children,
}: CircularProgressProps) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      {children && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {children}
        </div>
      )}
    </div>
  );
}
