"use client";

import { ShieldCheck } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerComplianceQuery } from "@/hooks/use-partner-os";
import Link from "next/link";

const STATUS_TONE: Record<string, string> = {
  VERIFIED: "text-emerald-700 bg-emerald-50 border-emerald-100",
  EXPIRING: "text-amber-800 bg-amber-50 border-amber-100",
  ACTION_REQUIRED: "text-amber-900 bg-amber-50 border-amber-200",
  RESTRICTED: "text-red-800 bg-red-50 border-red-100",
};

export default function TrustCompliancePage() {
  const compliance = usePartnerComplianceQuery();
  const data = compliance.data;
  const status = data?.status;
  const loading = compliance.isLoading && !data;
  const error =
    compliance.isError && !data
      ? compliance.error instanceof Error
        ? compliance.error.message
        : "Compliance status is unavailable."
      : null;

  return (
    <HqPageShell
      title="Compliance Center"
      description="KYC, documents, certifications, and insurance — status is calculated by the platform, not this screen."
      icon={ShieldCheck}
      loading={loading}
      error={error}
      onRetry={() => void compliance.refetch()}
      stats={
        data
          ? [
              { label: "Status", value: status!.replace(/_/g, " ") },
              { label: "Documents", value: data.documents.length },
              { label: "Expiring", value: data.expiringSoon },
              { label: "Verified", value: data.verification?.isVerified ? "Yes" : "Pending" },
            ]
          : undefined
      }
    >
      {data ? (
        <>
          <section
            className={`partner-card border p-5 ${STATUS_TONE[status ?? ""] ?? ""}`}
            data-testid="compliance-status"
            aria-live="polite"
          >
            <p className="text-sm font-semibold tracking-wide">{(status ?? "").replace(/_/g, " ")}</p>
            {/* No opacity on the tone colour: at 80 % the emerald text fell to 3.68:1 (axe, WCAG AA 4.5:1). */}
            <p className="mt-1 text-sm">{data.explanation}</p>
          </section>

          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                href: "/trust-compliance/verification",
                label: "KYC",
                hint: String(data.verification?.kycStatus ?? "—"),
              },
              {
                href: "/trust-compliance/compliance",
                label: "Documents",
                hint: `${data.documents.length} on file`,
              },
              {
                href: "/trust-compliance/compliance",
                label: "Certifications",
                hint: `${data.certifications.length}`,
              },
              {
                href: "/trust-compliance/compliance",
                label: "Insurance",
                hint: `${data.insurance?.length ?? 0} policies`,
              },
            ].map((card) => (
              <Link key={card.label} href={card.href} className="partner-card partner-card-hover p-4">
                <p className="font-semibold">{card.label}</p>
                <p className="mt-1 text-sm text-partner-muted">{card.hint}</p>
              </Link>
            ))}
          </div>
        </>
      ) : null}
    </HqPageShell>
  );
}
