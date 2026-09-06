"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  ExternalLink,
  MapPin,
  Phone,
  Mail,
  Sparkles,
  User,
} from "lucide-react";
import { LeadStatusChip } from "@/components/acquisition/LeadStatusChip";
import { LeadTimeline } from "@/components/acquisition/LeadTimeline";
import { formatFollowUp, followUpTone, leadInitials } from "@/lib/lead-crm-utils";
import { cn } from "@/lib/cn";
import type { PartnerDuplicateMatch, PartnerLeadDetail } from "@/services/admin-api";

type Section = "overview" | "contact" | "application" | "activity" | "notes";

type LeadDetailPanelProps = {
  lead: PartnerLeadDetail;
  assigneeName?: string;
  notes: string;
  onNotesChange: (v: string) => void;
  onSaveNotes: () => void;
  notesSaving?: boolean;
  hideFullPageLink?: boolean;
  onStartApplication?: () => void;
  onResolveDuplicate?: (candidate: PartnerDuplicateMatch) => void;
  className?: string;
};

const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "contact", label: "Contact" },
  { key: "application", label: "Application" },
  { key: "activity", label: "Activity" },
  { key: "notes", label: "Notes" },
];

export function LeadDetailPanel({
  lead,
  assigneeName,
  notes,
  onNotesChange,
  onSaveNotes,
  notesSaving,
  hideFullPageLink,
  onStartApplication,
  onResolveDuplicate,
  className,
}: LeadDetailPanelProps) {
  const [section, setSection] = useState<Section>("overview");
  const followTone = followUpTone(lead.nextFollowUpAt);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="flex items-start gap-4 border-b border-[var(--color-biz-line)] pb-5">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--color-biz-line)] bg-gradient-to-br from-[var(--color-biz-accent-dim)] to-transparent text-lg font-bold">
          {leadInitials(lead.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-xl font-bold tracking-tight">{lead.name}</h2>
            <LeadStatusChip status={lead.status} />
          </div>
          <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
            {lead.skillInterest ?? "General partner"}
            {(lead.zone || lead.city) && (
              <>
                {" "}
                · <MapPin className="mr-0.5 inline h-3.5 w-3.5" />
                {[lead.zone, lead.city].filter(Boolean).join(", ")}
              </>
            )}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-biz-faint)]">
            Source {lead.source.replace(/_/g, " ")}
            {lead.sourceCampaign ? ` · ${lead.sourceCampaign}` : ""}
          </p>
        </div>
        {!hideFullPageLink ? (
          <Link
            href={`/partner-acquisition/leads/${lead.id}`}
            className="hidden shrink-0 items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)] sm:inline-flex"
          >
            Full page
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </div>
      {lead.duplicateCandidates?.length ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold text-amber-950">Possible duplicate</p>
          {lead.duplicateCandidates.slice(0, 3).map((c) => (
            <div key={`${c.type}-${c.id}`} className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-amber-950">
                {c.name} · {c.phoneMasked} · {c.status}
                {c.city ? ` · ${c.city}` : ""}
              </span>
              {onResolveDuplicate ? (
                <button type="button" className="text-xs font-semibold text-amber-900" onClick={() => onResolveDuplicate(c)}>
                  Review
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSection(s.key)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition",
              section === s.key
                ? "bg-[var(--color-biz-accent-dim)] text-[var(--color-biz-accent)]"
                : "text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex-1 overflow-y-auto pr-1">
        {section === "overview" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric icon={Sparkles} label="Lead score" value={String(lead.leadScore)} accent />
            <Metric icon={User} label="Assigned to" value={assigneeName ?? "Unassigned"} />
            <Metric
              icon={CalendarClock}
              label="Next follow-up"
              value={formatFollowUp(lead.nextFollowUpAt)}
              tone={followTone}
            />
            <Metric label="Last activity" value={lead.lastActivityAt ? new Date(lead.lastActivityAt).toLocaleString("en-IN") : "—"} />
            {lead.followUpReason ? (
              <div className="sm:col-span-2 rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/40 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-faint)]">Follow-up note</p>
                <p className="mt-1 text-sm">{lead.followUpReason}</p>
              </div>
            ) : null}
          </div>
        )}

        {section === "contact" && (
          <div className="space-y-3">
            <ContactRow icon={Phone} label="Phone" value={lead.phone} href={`tel:${lead.phone}`} />
            <ContactRow
              icon={Mail}
              label="Email"
              value={lead.email ?? "Not provided"}
              href={lead.email ? `mailto:${lead.email}` : undefined}
            />
            <InfoRow label="Channel" value={lead.channel ?? "—"} />
            <InfoRow label="Preferred contact" value={lead.preferredContactMethod ?? "—"} />
          </div>
        )}

        {section === "application" && (
          <div className="space-y-4">
            {lead.provider ? (
              <>
                <InfoRow label="Registration" value={lead.provider.registrationStatus} />
                <InfoRow label="Services" value={lead.provider.serviceCategories.join(", ") || "—"} />
                <Link
                  href={`/vendors/${lead.provider.id}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--color-biz-accent)]"
                >
                  Open application workspace
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-[var(--color-biz-line)] px-4 py-8 text-center">
                <p className="text-sm font-medium">No application linked yet</p>
                <p className="mt-1 text-xs text-[var(--color-biz-muted)]">
                  Invite them into Partner onboarding. No operational partner is created until they finish registration.
                </p>
                {onStartApplication ? (
                  <button
                    type="button"
                    onClick={onStartApplication}
                    className="mt-4 rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Start application
                  </button>
                ) : null}
              </div>
            )}
            {lead.statusHistory.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
                  Status history
                </p>
                <div className="space-y-2">
                  {lead.statusHistory.slice(0, 5).map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between rounded-lg border border-[var(--color-biz-line)] px-3 py-2 text-xs"
                    >
                      <span>
                        {h.fromStatus ? `${h.fromStatus} → ` : ""}
                        {h.toStatus}
                      </span>
                      <span className="text-[var(--color-biz-faint)]">
                        {new Date(h.createdAt).toLocaleDateString("en-IN")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {section === "activity" && <LeadTimeline activities={lead.activities} limit={20} />}

        {section === "notes" && (
          <div className="space-y-3">
            <textarea
              value={notes}
              onChange={(e) => onNotesChange(e.target.value)}
              rows={8}
              placeholder="Internal notes about this lead…"
              className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] px-3 py-2.5 text-sm outline-none ring-[var(--color-biz-accent)] focus:ring-2"
            />
            <button
              type="button"
              disabled={notesSaving}
              onClick={onSaveNotes}
              className="rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {notesSaving ? "Saving…" : "Save notes"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  accent,
  tone,
}: {
  icon?: typeof Sparkles;
  label: string;
  value: string;
  accent?: boolean;
  tone?: "overdue" | "today" | "upcoming" | "none";
}) {
  return (
    <div className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)]/30 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-[var(--color-biz-faint)]">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </div>
      <p
        className={cn(
          "mt-1 text-sm font-semibold",
          accent && "font-num text-lg text-[var(--color-biz-accent)]",
          tone === "overdue" && "text-[var(--color-biz-danger)]",
          tone === "today" && "text-[var(--color-biz-warning)]",
          tone === "upcoming" && "text-[var(--color-biz-cyan)]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  href?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--color-biz-line)] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-[var(--color-biz-muted)]" />
        <div>
          <p className="text-[11px] uppercase tracking-wide text-[var(--color-biz-faint)]">{label}</p>
          <p className="text-sm font-medium">{value}</p>
        </div>
      </div>
      {href ? (
        <a href={href} className="text-xs font-semibold text-[var(--color-biz-accent)]">
          Open
        </a>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 text-sm">
      <span className="text-[var(--color-biz-muted)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
