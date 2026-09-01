"use client";

import { FileText, Scale, ShieldCheck } from "lucide-react";
import { CommandHubPage } from "@/components/command/CommandHubPage";
import { CommandCenterRail } from "@/components/command/CommandCenterRail";

export default function KycPage() {
  return (
    <CommandHubPage
      icon={ShieldCheck}
      tone="warning"
      title="KYC"
      subtitle="Partner identity, documents, and compliance — verification still runs through Section 01 / 05 services."
      links={[
        { href: "/partner-acquisition/verification", label: "Verification queue", description: "Acquisition verification", icon: ShieldCheck },
        { href: "/vendors/documents", label: "Document review", description: "Pending partner documents", icon: FileText },
        { href: "/trust-safety/compliance", label: "Partner compliance", description: "Expiry, restriction, KYC validity", icon: Scale, tone: "danger" },
      ]}
    >
      <CommandCenterRail />
    </CommandHubPage>
  );
}
