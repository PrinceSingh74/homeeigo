"use client";

import { Flame, Gauge, MapPinned } from "lucide-react";
import { OperationsPage } from "@/components/operations/OperationsPage";
import { CommandHubPage } from "@/components/command/CommandHubPage";

export default function SupplyDemandPage() {
  return (
    <OperationsPage
      icon={Flame}
      iconTone="warning"
      title="Supply-Demand"
      subtitle="Where demand outruns supply. Canonical heatmap, coverage, and Command Center demand layers — no second matching engine."
    >
      <CommandHubPage
        embedded
        icon={Flame}
        tone="warning"
        title="Open the live layers"
        subtitle="Each destination is a real ops surface. Heatmap is cells, coverage is cities, Command Center is the live map."
        links={[
          { href: "/heatmap", label: "Demand heatmap", description: "Supply online vs demand cells", icon: Flame, tone: "danger" },
          { href: "/coverage", label: "Coverage intelligence", description: "Gaps and zone coverage", icon: MapPinned },
          { href: "/command-center", label: "Command Center map", description: "Live density, surge, demand", icon: Gauge, tone: "success" },
        ]}
      />
    </OperationsPage>
  );
}
