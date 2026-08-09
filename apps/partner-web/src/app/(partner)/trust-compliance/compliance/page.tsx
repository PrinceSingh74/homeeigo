"use client";

import { FileCheck2 } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerComplianceQuery } from "@/hooks/use-partner-os";

export default function ComplianceDetailsPage() {
  const compliance = usePartnerComplianceQuery();

  return (
    <HqPageShell
      title="Compliance"
      description="Document verification and expiry tracking with admin approval workflows."
      icon={FileCheck2}
    >
      <section className="space-y-2">
        {(compliance.data?.documents ?? []).map((doc) => (
          <article key={doc.id} className="partner-card flex flex-wrap items-center justify-between gap-2 p-4 text-sm">
            <div>
              <p className="font-semibold">{doc.documentName ?? doc.documentType}</p>
              <p className="text-partner-muted">{doc.isVerified ? "Verified" : "Pending review"}</p>
            </div>
            {doc.expiringSoon ? <span className="text-partner-warning text-xs font-semibold">Expiring soon</span> : null}
          </article>
        ))}
      </section>
    </HqPageShell>
  );
}
