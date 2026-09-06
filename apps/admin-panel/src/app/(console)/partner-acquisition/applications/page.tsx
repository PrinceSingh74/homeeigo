"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { QueueFilterBar, QueueTable } from "@/components/acquisition/QueueTable";
import { adminApi } from "@/services/admin-api";

const PIPELINES = [
  { key: "all", label: "All" },
  { key: "started", label: "Started" },
  { key: "submitted", label: "Submitted" },
  { key: "kyc", label: "KYC" },
  { key: "assessment", label: "Assessment" },
  { key: "training", label: "Training" },
  { key: "ready", label: "Ready" },
  { key: "rejected", label: "Rejected" },
  { key: "changes_requested", label: "Changes requested" },
];

export default function PartnerApplicationsPage() {
  const [pipeline, setPipeline] = useState("all");
  const [search, setSearch] = useState("");
  const query = useQuery({
    queryKey: ["admin", "partner-acquisition", "applications", pipeline, search],
    queryFn: () =>
      adminApi.partnerAcquisition.applications({
        pipeline: pipeline !== "all" ? pipeline : undefined,
        search: search || undefined,
      }),
  });

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Applications"
        subtitle="Applicant pipeline — not a substitute for lead status. Each row is a real Provider application."
      />
      <GlassPanel className="space-y-4 p-4">
        <QueueFilterBar filters={PIPELINES} active={pipeline} onChange={setPipeline} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search applicant name…"
          className="w-full rounded-xl border border-[var(--color-biz-line)] px-3 py-2 text-sm"
        />
      </GlassPanel>
      <GlassPanel className="overflow-hidden p-0">
        <QueueTable
          columns={["Applicant", "City", "Skill", "Pipeline", "Lead status", "Submitted"]}
          empty="No applications in this view."
          rows={(query.data?.items ?? []).map((row) => ({
            id: row.providerId,
            href: `/vendors/${row.providerId}`,
            cells: [
              row.name,
              row.city ?? "—",
              row.skill ?? "—",
              row.pipeline.replace(/_/g, " "),
              row.leadStatus ?? "—",
              row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : "—",
            ],
          }))}
        />
      </GlassPanel>
    </div>
  );
}
