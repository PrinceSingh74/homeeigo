"use client";

import type { ReactNode } from "react";
import { useAppStore } from "@/stores/app-store";
import { cn } from "@/lib/utils";

export function HomeHelpWatch({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const openOverlay = useAppStore((s) => s.openOverlay);
  return (
    <button type="button" onClick={() => openOverlay("how-it-works")} className={cn(className)}>
      {children}
    </button>
  );
}
