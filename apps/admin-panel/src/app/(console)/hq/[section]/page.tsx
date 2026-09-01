"use client";

import { notFound, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { getHqSection, type HqSectionId } from "@/lib/hq-navigation";
import { HqLandingShell } from "@/components/hq/HqLandingShell";
import { HqQuickLinkGrid } from "@/components/hq/HqQuickLinkGrid";
import { SectionHeading } from "@/components/hq/primitives";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";

const VALID_SECTIONS: HqSectionId[] = [
  "operations",
  "marketplace",
  "acquisition",
  "growth",
  "network",
  "finance",
  "risk",
  "ai",
  "automation",
  "monitoring",
  "audit",
  "platform",
];

const GrowthHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/GrowthHqDashboard").then((m) => m.GrowthHqDashboard),
  { ssr: false },
);
const MarketplaceHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/MarketplaceHqDashboard").then((m) => m.MarketplaceHqDashboard),
  { ssr: false },
);
const MonitoringHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/MonitoringHqDashboard").then((m) => m.MonitoringHqDashboard),
  { ssr: false },
);
const AiHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/AiHqDashboard").then((m) => m.AiHqDashboard),
  { ssr: false },
);
const OperationsHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/OperationsHqDashboard").then((m) => m.OperationsHqDashboard),
  { ssr: false },
);
const FinanceHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/FinanceHqDashboard").then((m) => m.FinanceHqDashboard),
  { ssr: false },
);
const RiskHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/RiskHqDashboard").then((m) => m.RiskHqDashboard),
  { ssr: false },
);
const PlatformHqDashboard = dynamic(
  () => import("@/components/hq/dashboards/PlatformHqDashboard").then((m) => m.PlatformHqDashboard),
  { ssr: false },
);

export default function HqLandingPage() {
  useRenderProbe("HqLandingPage");
  useMountProbe("HqLandingPage");
  const params = useParams();
  const sectionId = params.section as string;
  const section = getHqSection(sectionId as HqSectionId);

  if (!section || !VALID_SECTIONS.includes(sectionId as HqSectionId)) {
    notFound();
  }

  const quickLinks = useMemo(
    () => section.items.map((item) => ({ href: item.href, label: item.label, icon: item.icon })),
    [section.items],
  );

  const Dashboard = useMemo(() => {
    switch (sectionId as HqSectionId) {
      case "operations":
        return <OperationsHqDashboard />;
      case "marketplace":
        return <MarketplaceHqDashboard />;
      case "growth":
        return <GrowthHqDashboard />;
      case "finance":
        return <FinanceHqDashboard />;
      case "risk":
        return <RiskHqDashboard />;
      case "ai":
        return <AiHqDashboard />;
      case "monitoring":
        return <MonitoringHqDashboard />;
      case "platform":
        return <PlatformHqDashboard />;
      default:
        return null;
    }
  }, [sectionId]);

  return (
    <HqLandingShell
      emoji={section.emoji}
      title={section.label}
      subtitle={section.description}
      className={sectionId === "marketplace" ? "max-w-[1600px]" : undefined}
    >
      {Dashboard}

      <section>
        <SectionHeading title="Quick access" hint={`${section.items.length} tools`} />
        <HqQuickLinkGrid links={quickLinks} columns={section.items.length > 6 ? 3 : 2} />
      </section>
    </HqLandingShell>
  );
}
