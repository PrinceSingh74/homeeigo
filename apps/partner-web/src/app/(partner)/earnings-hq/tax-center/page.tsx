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
      description="GST, TDS, tax summary, and annual report from provider tax API."
      icon={FileCheck2}
      stats={[
        { label: "GST (on commission)", value: inr(data?.gstOnCommission ?? 0) },
        { label: "TDS estimate", value: inr(data?.tdsEstimate ?? 0) },
        { label: "Tax summary", value: inr(data?.estimatedTax ?? 0) },
        { label: "Annual FY", value: data?.financialYear ?? "—" },
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
