"use client";

import { ShieldCheck } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerComplianceQuery } from "@/hooks/use-partner-os";
import Link from "next/link";

export default function TrustCompliancePage() {
  const compliance = usePartnerComplianceQuery();
  const data = compliance.data;

  return (
    <HqPageShell
      title="Trust & Compliance"
      description="Documents, verification, compliance score, and expiry tracking."
      icon={ShieldCheck}
      stats={[
        { label: "Compliance score", value: `${data?.complianceScore ?? 0}%` },
        { label: "Documents", value: data?.documents.length ?? 0 },
        { label: "Expiring soon", value: data?.expiringSoon ?? 0 },
        { label: "Verified", value: data?.verification?.isVerified ? "Yes" : "Pending" },
      ]}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Link href="/trust-compliance/verification" className="partner-card partner-card-hover p-4 font-semibold">
          Verification Center
        </Link>
        <Link href="/trust-compliance/compliance" className="partner-card partner-card-hover p-4 font-semibold">
          Compliance details
        </Link>
      </div>
    </HqPageShell>
  );
}
