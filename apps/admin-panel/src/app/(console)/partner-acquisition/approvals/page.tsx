"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { QueueFilterBar, QueueTable } from "@/components/acquisition/QueueTable";
import { adminApi } from "@/services/admin-api";

const STATUSES = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready for review" },
  { key: "pending", label: "Pending approval" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "changes_requested", label: "Changes requested" },
];

export default function PartnerApprovalsPage() {
  const [status, setStatus] = useState("all");
  const query = useQuery({
    queryKey: ["admin", "partner-acquisition", "approvals", status],
    queryFn: () =>
      adminApi.partnerAcquisition.approvals({
        status: status !== "all" ? status : undefined,
      }),
  });

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Approvals"
        subtitle="Review profile, KYC, documents, assessment, training, location, and availability. Approve, reject, or request changes on the partner record."
      />
      <GlassPanel className="p-4">
        <QueueFilterBar filters={STATUSES} active={status} onChange={setStatus} />
      </GlassPanel>
      <GlassPanel className="overflow-hidden p-0">
        <QueueTable
          columns={["Applicant", "City", "Skill", "Status", "Assessment", "Training", "Submitted"]}
          empty="No approvals in this view."
          rows={(query.data?.items ?? []).map((row) => ({
            id: row.providerId,
            href: `/vendors/${row.providerId}`,
            cells: [
              row.name,
              row.city ?? "—",
              row.skill ?? "—",
              row.status.replace(/_/g, " "),
              row.assessmentPassed ? "Passed" : "Pending",
              row.trainingComplete ? "Complete" : "In progress",
              row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : "—",
            ],
          }))}
        />
      </GlassPanel>
      <p className="text-xs text-[var(--color-biz-muted)]">
        Open an applicant to approve, reject (reason required), or request changes using the existing partner verification workflow.
      </p>
    </div>
  );
}
