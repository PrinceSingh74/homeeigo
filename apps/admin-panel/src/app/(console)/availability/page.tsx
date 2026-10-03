"use client";

import { UserCheck } from "lucide-react";
import { LivePartnerAvailabilityRoster } from "@/components/operations/LivePartnerAvailabilityRoster";
import { OperationsPage } from "@/components/operations/OperationsPage";

export default function AvailabilityPage() {
  return (
    <OperationsPage
      icon={UserCheck}
      title="Availability"
      subtitle="Who can take a job right now. Availability is its own axis — it is not partner lifecycle, not job stage, and not finance."
    >
      <LivePartnerAvailabilityRoster heading={false} />
    </OperationsPage>
  );
}
