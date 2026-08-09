"use client";

import { usePartnerNotificationsQuery } from "@/hooks/use-partner-data";
import { usePartnerWellbeingQuery } from "@/hooks/use-partner-os";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { ExternalLink, MessageSquare } from "lucide-react";

export default function WellbeingCommunityPage() {
  const wellbeing = usePartnerWellbeingQuery();
  const notifications = usePartnerNotificationsQuery({ page: 1, limit: 20 });
  const communityUrl = wellbeing.data?.communityUrl?.trim();

  return (
    <HqPageShell
      title="Community & Announcements"
      description="Partner community portal plus in-app announcements from the notifications feed."
      icon={MessageSquare}
      stats={[
        { label: "Announcements", value: notifications.data?.notifications.length ?? 0 },
        { label: "Community", value: communityUrl ? "Linked" : "In-app only" },
      ]}
    >
      {communityUrl ? (
        <a
          href={communityUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="partner-card partner-card-hover mb-4 flex items-center justify-between p-4"
        >
          <span className="font-semibold">Open partner community</span>
          <ExternalLink className="h-4 w-4 text-partner-primary" />
        </a>
      ) : null}

      <div className="space-y-2">
        {(notifications.data?.notifications ?? []).length === 0 ? (
          <div className="partner-card p-6 text-center text-sm text-partner-muted">No announcements yet.</div>
        ) : (
          (notifications.data?.notifications ?? []).map((n) => (
            <article key={n.id} className="partner-card p-4">
              <p className="font-semibold">{n.title}</p>
              <p className="mt-1 text-sm text-partner-muted">{n.message}</p>
              <p className="mt-2 text-xs text-partner-muted-dim">{new Date(n.createdAt).toLocaleString("en-IN")}</p>
            </article>
          ))
        )}
      </div>
    </HqPageShell>
  );
}
