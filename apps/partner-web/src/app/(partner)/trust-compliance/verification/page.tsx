"use client";

import { ShieldCheck } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerComplianceQuery } from "@/hooks/use-partner-os";

export default function VerificationPage() {
  const compliance = usePartnerComplianceQuery();
  const v = compliance.data?.verification as Record<string, string | boolean> | undefined;

  return (
    <HqPageShell
      title="Verification Center"
      description="KYC and background verification status from compliance API."
      icon={ShieldCheck}
      stats={[
        { label: "Identity", value: v?.isVerified ? "Verified" : "Pending" },
        { label: "KYC", value: String(v?.kycStatus ?? "—") },
        { label: "Background", value: String(v?.backgroundCheckStatus ?? "—") },
        { label: "BG workflow", value: String(v?.backgroundCheck ?? "—") },
      ]}
    />
  );
}
