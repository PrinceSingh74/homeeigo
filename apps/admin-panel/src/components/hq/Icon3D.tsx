"use client";

import { memo } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type Icon3DTone = "default" | "cyan" | "success" | "warning" | "danger";
export type Icon3DSize = "sm" | "md" | "lg";

export const Icon3D = memo(function Icon3D({
  icon: Icon,
  tone = "default",
  size = "md",
  className,
}: {
  icon: LucideIcon;
  tone?: Icon3DTone;
  size?: Icon3DSize;
  className?: string;
}) {
  return (
    <span className={cn("biz-icon-3d-wrap", `biz-icon-3d--${size}`, className)}>
      <span className={cn("biz-icon-3d", `biz-icon-3d--${tone}`)} aria-hidden>
        <span className="biz-icon-3d-layer biz-icon-3d-layer--3" />
        <span className="biz-icon-3d-layer biz-icon-3d-layer--2" />
        <span className="biz-icon-3d-face">
          <Icon strokeWidth={2.15} />
          <span className="biz-icon-3d-shine" />
        </span>
      </span>
    </span>
  );
});
