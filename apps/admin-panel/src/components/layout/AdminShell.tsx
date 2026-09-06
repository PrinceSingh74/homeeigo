"use client";

import { HqSidebar } from "./HqSidebar";
import { MobileHqNav } from "./MobileHqNav";
import { AdminTopBar } from "./AdminTopBar";
import { AdminRoutePrefetch } from "@/components/navigation/AdminRoutePrefetch";
import { RouteProgress } from "@/components/navigation/RouteProgress";
import { RouteTransitionTracker } from "@/lib/route-transition-metrics";
import { useMountProbe } from "@/lib/render-probe";

export function AdminShell({ children }: { children: React.ReactNode }) {
  useMountProbe("AdminShell");

  return (
    <div className="flex h-dvh overflow-hidden bg-[var(--color-biz-bg)]">
      <RouteProgress />
      <RouteTransitionTracker />
      <AdminRoutePrefetch />
      <HqSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <MobileHqNav />
        <AdminTopBar />
        <main
          tabIndex={0}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-auto p-4 md:p-6 xl:p-8 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-biz-accent)]"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
