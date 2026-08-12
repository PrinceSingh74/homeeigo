"use client";

import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/admin-api";
import { Users, Radio, ClipboardCheck, TrendingUp } from "lucide-react";

export default function WorkforcePage() {
  const analytics = useQuery({
    queryKey: ["admin", "workforce"],
    queryFn: () => adminApi.workforceAnalytics(),
  });

  const data = analytics.data;

  const cards = [
    { label: "Online partners", value: data?.onlineProviders ?? 0, icon: Radio },
    { label: "Total partners", value: data?.totalProviders ?? 0, icon: Users },
    { label: "Active jobs", value: data?.activeJobs ?? 0, icon: ClipboardCheck },
    { label: "Check-ins today", value: data?.attendanceCheckInsToday ?? 0, icon: TrendingUp },
    { label: "Avg acceptance", value: `${data?.avgAcceptanceRate ?? 0}%`, icon: TrendingUp },
    { label: "Avg completion", value: `${data?.avgCompletionRate ?? 0}%`, icon: TrendingUp },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Workforce Analytics</h1>
        <p className="text-sm text-muted-foreground">Partner OS workforce metrics — attendance, online status, and performance.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-xl border bg-card p-5 shadow-sm">
            <Icon className="h-5 w-5 text-primary" />
            <p className="mt-3 text-2xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
