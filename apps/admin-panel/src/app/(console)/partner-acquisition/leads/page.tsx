"use client";

import { Suspense } from "react";
import { LeadCrmWorkspace } from "@/components/acquisition/LeadCrmWorkspace";
import { GlassPanel } from "@/components/hq/GlassPanel";

export default function PartnerLeadsPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <GlassPanel className="h-12 animate-pulse" />
          <GlassPanel className="h-[620px] animate-pulse" />
        </div>
      }
    >
      <LeadCrmWorkspace />
    </Suspense>
  );
}
