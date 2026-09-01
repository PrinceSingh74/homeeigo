"use client";

import { Flame, MapPinned, Gauge } from "lucide-react";
import { CommandHubPage } from "@/components/command/CommandHubPage";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";

export default function SupplyDemandPage() {
  return (
    <CommandHubPage
      icon={Flame}
      tone="warning"
      title="Supply-Demand"
      subtitle="Canonical heatmap, coverage intelligence, and Command Center demand layers. No second matching engine."
      links={[
        { href: "/heatmap", label: "Demand heatmap", description: "Supply online vs demand cells", icon: Flame, tone: "danger" },
        { href: "/coverage", label: "Coverage intelligence", description: "Gaps and zone coverage", icon: MapPinned },
        { href: "/command-center", label: "Command Center map", description: "Live density, surge, demand", icon: Gauge, tone: "success" },
      ]}
    >
      <CommandCenterRail />
    </CommandHubPage>
  );
}
