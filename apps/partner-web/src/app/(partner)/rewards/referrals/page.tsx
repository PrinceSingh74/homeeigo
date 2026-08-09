"use client";

import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { Trophy } from "lucide-react";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function RewardsReferralsPage() {
  const referrals = useQuery({
    queryKey: ["partner", "referrals-me"],
    queryFn: () => partnerApi.referrals.summary(),
  });

  const data = referrals.data;

  return (
    <HqPageShell
      title="Referral Program"
      description="Live referral wallet and commission from /api/referrals/me."
      icon={Trophy}
      stats={[
        { label: "Referral code", value: data?.code ?? "—" },
        { label: "Referrals", value: data?.referralCount ?? 0 },
        { label: "Balance", value: inr(data?.balance ?? 0) },
        { label: "Total earned", value: inr(data?.totalEarned ?? 0) },
      ]}
    />
  );
}
