"use client";

import { Radio } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { OperationsStatusCard } from "@/components/availability/OperationsStatusCard";
import { CapacityCard } from "@/components/availability/CapacityCard";
import { AvailabilityScheduleForm } from "@/components/availability/AvailabilityScheduleForm";
import { ServiceAreaWorkspace } from "@/components/availability/ServiceAreaWorkspace";
import { usePartnerOperationsQuery } from "@/hooks/use-partner-data";

export default function AvailabilityPage() {
  const ops = usePartnerOperationsQuery();
  const data = ops.data;

  return (
    <HqPageShell
      title="Availability"
      description="Go online, set when you work, and choose where you take jobs. Dispatch uses this as the source of truth."
      icon={Radio}
      stats={[
        { label: "Status", value: data?.operationalStatus?.replace("_", " ") ?? "—" },
        { label: "Capacity", value: data ? `${data.capacity.currentJobs} / ${data.capacity.maxConcurrentJobs}` : "—" },
        { label: "Slots", value: data?.capacity.availableSlots ?? "—" },
        { label: "Areas", value: data?.serviceRegions.length ?? 0 },
      ]}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <OperationsStatusCard />
        <CapacityCard ops={data} loading={ops.isLoading} />
      </div>
      <AvailabilityScheduleForm />
      <ServiceAreaWorkspace />
    </HqPageShell>
  );
}
