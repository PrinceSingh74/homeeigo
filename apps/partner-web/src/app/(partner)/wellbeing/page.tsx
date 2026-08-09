"use client";

import { HeartPulse } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerWellbeingQuery } from "@/hooks/use-partner-os";
import Link from "next/link";

export default function WellbeingPage() {
  const wellbeing = usePartnerWellbeingQuery();
  const data = wellbeing.data;

  return (
    <HqPageShell
      title="Wellbeing HQ"
      description="Insurance, emergency support, SOS, and community resources."
      icon={HeartPulse}
      stats={[
        { label: "SOS hotline", value: data?.sosPhone ?? "—" },
        { label: "Insurance", value: data?.insuranceUrl ? "Configured" : "Contact support" },
        { label: "Community", value: data?.communityUrl ? "Active" : "In-app" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Link href="/wellbeing/sos" className="partner-card partner-card-hover p-4 text-center font-semibold">SOS</Link>
        <Link href="/wellbeing/community" className="partner-card partner-card-hover p-4 text-center font-semibold">Community</Link>
        <Link href="/support" className="partner-card partner-card-hover p-4 text-center font-semibold">Emergency support</Link>
      </div>
      {data?.insuranceUrl ? (
        <a href={data.insuranceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-partner-primary underline">
          Open insurance portal
        </a>
      ) : null}
    </HqPageShell>
  );
}
