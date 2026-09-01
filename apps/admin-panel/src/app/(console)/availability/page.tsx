"use client";

import { LivePartnerAvailabilityRoster } from "@/components/operations/LivePartnerAvailabilityRoster";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";

export default function AvailabilityPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <CommandCenterRail />
      <LivePartnerAvailabilityRoster />
    </div>
  );
}
