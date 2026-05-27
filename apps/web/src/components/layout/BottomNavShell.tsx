"use client";

import { BottomNav } from "@/components/BottomNav";

/** Persistent mobile nav across tab routes (same on /ai as other pages). */
export function BottomNavShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <BottomNav />
    </>
  );
}
