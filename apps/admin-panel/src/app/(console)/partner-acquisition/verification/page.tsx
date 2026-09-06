"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { QueueFilterBar, QueueTable } from "@/components/acquisition/QueueTable";
import { adminApi } from "@/services/admin-api";

const STATUSES = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "needs_attention", label: "Needs attention" },
  { key: "verified", label: "Verified" },
  { key: "rejected", label: "Rejected" },
];

export default function PartnerVerificationPage() {
  const [status, setStatus] = useState("all");
  const query = useQuery({
    queryKey: ["admin", "partner-acquisition", "verification", status],
    queryFn: () =>
      adminApi.partnerAcquisition.verification({
        status: status !== "all" ? status : undefined,
      }),
  });

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Verification"
        subtitle="KYC, documents, background check, and assessment — reuse existing partner verification systems."
      />
      <GlassPanel className="p-4">
        <QueueFilterBar filters={STATUSES} active={status} onChange={setStatus} />
      </GlassPanel>
      <GlassPanel className="overflow-hidden p-0">
        <QueueTable
          columns={["Applicant", "City", "Status", "KYC", "Documents", "Background", "Assessment"]}
          empty="No verification work in this view."
          rows={(query.data?.items ?? []).map((row) => ({
            id: row.providerId,
            href: `/vendors/${row.providerId}`,
            cells: [
              row.name,
              row.city ?? "—",
              row.status.replace(/_/g, " "),
              row.kyc,
              row.documents,
              row.background ?? "—",
              row.assessment,
            ],
          }))}
        />
      </GlassPanel>
    </div>
  );
}
