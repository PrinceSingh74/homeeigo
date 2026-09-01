"use client";

import { Brain, Eye, Globe2, Gauge } from "lucide-react";
import { CommandHubPage } from "@/components/command/CommandHubPage";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";

export default function AiInsightsPage() {
  return (
    <CommandHubPage
      icon={Brain}
      tone="cyan"
      title="AI Insights"
      subtitle="Section 08 intelligence surfaces. This hub does not run models — it routes to the canonical AI Brain, vision, and geo insight pages."
      links={[
        { href: "/command-center", label: "Command Center intel", description: "Surge, demand, fraud, revenue panels", icon: Gauge, tone: "success" },
        { href: "/ai-brain", label: "AI Brain", description: "Timeline, memory, prompts, approvals", icon: Brain },
        { href: "/digital-twin", label: "City Twin", description: "Geo digital twin insights", icon: Globe2 },
        { href: "/vision", label: "Vision analytics", description: "Vision jobs and quality", icon: Eye },
      ]}
    >
      <CommandCenterRail />
    </CommandHubPage>
  );
}
