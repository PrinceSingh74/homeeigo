"use client";

import { usePartnerMeQuery } from "@/hooks/use-partner-data";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { GraduationCap } from "lucide-react";

export default function AcademyCertificationsPage() {
  const me = usePartnerMeQuery();

  return (
    <HqPageShell
      title="Certifications"
      description="Certifications stored on your provider profile and managed by operations."
      icon={GraduationCap}
      stats={[{ label: "Active certifications", value: me.data?.certifications.length ?? 0 }]}
    >
      <ul className="space-y-2">
        {(me.data?.certifications ?? []).map((cert) => (
          <li key={cert} className="partner-card px-4 py-3 text-sm font-medium">
            {cert}
          </li>
        ))}
      </ul>
    </HqPageShell>
  );
}
