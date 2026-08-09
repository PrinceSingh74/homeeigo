"use client";

import Link from "next/link";
import { Phone, HeartPulse } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerWellbeingQuery } from "@/hooks/use-partner-os";

export default function WellbeingSosPage() {
  const wellbeing = usePartnerWellbeingQuery();
  const sosPhone = wellbeing.data?.sosPhone?.trim();
  const telHref = sosPhone ? `tel:${sosPhone.replace(/\s/g, "")}` : null;

  return (
    <HqPageShell
      title="SOS & Emergency Support"
      description="Configured emergency hotline from platform wellbeing settings plus critical support routing."
      icon={HeartPulse}
      stats={[{ label: "SOS hotline", value: sosPhone ?? "Contact support" }]}
    >
      <section className="partner-card space-y-4 p-5">
        {telHref ? (
          <a
            href={telHref}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-partner-danger text-base font-bold text-white transition hover:opacity-95 sm:w-auto sm:px-8"
          >
            <Phone className="h-5 w-5" />
            Call {sosPhone}
          </a>
        ) : (
          <p className="text-sm text-partner-muted">Emergency hotline not configured. Use support below.</p>
        )}
        <p className="text-sm text-partner-muted">
          For platform safety issues, open a critical-priority support ticket. Operations monitors SLA breaches in
          admin.
        </p>
        <Link
          href="/support"
          className="inline-flex h-10 items-center rounded-lg border border-partner-line px-4 text-sm font-semibold transition hover:bg-partner-primary/10"
        >
          Open emergency support ticket
        </Link>
      </section>
    </HqPageShell>
  );
}
