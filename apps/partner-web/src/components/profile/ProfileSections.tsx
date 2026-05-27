"use client";

import { BadgeCheck, FileText, Wrench } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerStore } from "@/stores/partner-store";
import Link from "next/link";

export function ProfileSections() {
  const vendor = usePartnerStore((s) => s.vendor);

  return (
    <div className="space-y-4">
      <PartnerCard className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-partner-primary/20 font-display text-2xl font-bold">
          {vendor.name.charAt(0)}
        </div>
        <div>
          <p className="font-display text-xl font-bold">{vendor.name}</p>
          <p className="text-sm text-partner-muted">{vendor.phone}</p>
          <p className="mt-1 flex items-center gap-1 text-sm text-partner-success">
            <BadgeCheck className="h-4 w-4" />
            KYC {vendor.kycStatus}
          </p>
        </div>
      </PartnerCard>

      <PartnerCard>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Wrench className="h-4 w-4 text-partner-primary" />
          Service categories
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {vendor.categories.map((c) => (
            <span
              key={c}
              className="rounded-full border border-partner-line px-3 py-1 text-xs"
            >
              {c}
            </span>
          ))}
        </div>
      </PartnerCard>

      <PartnerCard>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-partner-primary" />
          Documents
        </p>
        <ul className="mt-3 space-y-2 text-sm text-partner-muted">
          <li className="flex justify-between">
            <span>Aadhaar</span>
            <span className="text-partner-success">Verified</span>
          </li>
          <li className="flex justify-between">
            <span>PAN</span>
            <span className="text-partner-success">Verified</span>
          </li>
          <li className="flex justify-between">
            <span>Skill certificate — AC</span>
            <span className="text-partner-success">Verified</span>
          </li>
        </ul>
      </PartnerCard>

      <div className="grid gap-2 sm:grid-cols-2">
        <Link
          href="/analytics"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium"
        >
          Performance analytics
        </Link>
        <Link
          href="/reviews"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium"
        >
          Customer reviews
        </Link>
        <Link
          href="/availability"
          className="partner-card partner-card-hover rounded-2xl px-4 py-3 text-center text-sm font-medium sm:col-span-2"
        >
          Availability settings
        </Link>
      </div>
    </div>
  );
}
