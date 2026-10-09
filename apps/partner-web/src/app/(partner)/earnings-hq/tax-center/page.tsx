"use client";

import { FileCheck2 } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;

export default function TaxCenterPage() {
  const tax = useQuery({ queryKey: ["partner", "tax-center"], queryFn: () => partnerApi.taxSummary() });
  const data = tax.data;

  return (
    <HqPageShell
      title="Tax Center"
      description="Earnings totals only. HOMEEIGO does not remit GST or TDS on these figures. Partner is supplier of the service."
      icon={FileCheck2}
      stats={[
        { label: "GST remitted by HOMEEIGO", value: "None" },
        { label: "TDS withheld by HOMEEIGO", value: "None" },
        { label: "Illustrative estimate (not withheld)", value: inr(data?.estimatedTax ?? 0) },
        { label: "Calendar year label", value: data?.financialYear ?? "—" },
      ]}
    >
      <section className="partner-card grid gap-2 p-5 text-sm sm:grid-cols-2">
        <p>Gross: {inr(data?.grossEarnings ?? 0)}</p>
        <p>Commission: {inr(data?.platformCommission ?? 0)}</p>
        <p>Net: {inr(data?.netEarnings ?? 0)}</p>
        <p>Settled: {inr(data?.settledOut ?? 0)}</p>
      </section>
    </HqPageShell>
  );
}
