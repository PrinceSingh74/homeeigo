"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarClock,
  MessageSquare,
  Phone,
  PlayCircle,
  UserPlus,
  ArrowRightLeft,
} from "lucide-react";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { LeadStatusChip } from "@/components/acquisition/LeadStatusChip";
import { LeadDetailPanel } from "@/components/acquisition/LeadDetailPanel";
import { LeadTimeline } from "@/components/acquisition/LeadTimeline";
import { LeadAssignModal } from "@/components/acquisition/LeadAssignModal";
import { LeadStatusModal } from "@/components/acquisition/LeadStatusModal";
import { LeadFollowUpModal } from "@/components/acquisition/LeadFollowUpModal";
import { LeadStartApplicationModal } from "@/components/acquisition/LeadStartApplicationModal";
import { LeadMergeModal } from "@/components/acquisition/LeadMergeModal";
import {
  useAdminUsers,
  usePartnerLeadDetail,
  usePartnerLeadMutations,
} from "@/hooks/use-partner-lead-crm";
import { formatFollowUp, followUpTone, leadInitials, phoneHref, smsHref } from "@/lib/lead-crm-utils";
import { cn } from "@/lib/cn";
import type { PartnerDuplicateMatch } from "@/services/admin-api";

type ModalKind = "assign" | "status" | "followUp" | "start" | "merge" | null;

export default function PartnerLeadDetailPage() {
  const params = useParams<{ id: string }>();
  const lead = usePartnerLeadDetail(params.id);
  const admins = useAdminUsers();
  const mutations = usePartnerLeadMutations(params.id);
  const [modal, setModal] = useState<ModalKind>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [invite, setInvite] = useState<{ applicationUrl: string; smsBody: string; expiresInDays: number } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [mergeCandidate, setMergeCandidate] = useState<PartnerDuplicateMatch | null>(null);

  const data = lead.data;

  useEffect(() => {
    if (data) setNotesDraft(data.notes ?? "");
  }, [data?.id, data?.notes]);

  const assigneeName = useMemo(() => {
    const id = data?.assignedToAdminId;
    if (!id) return undefined;
    const admin = admins.data?.find((a) => a.id === id);
    if (!admin) return id.slice(0, 8);
    return (
      [admin.user?.firstName, admin.user?.lastName].filter(Boolean).join(" ") || admin.user?.email || id
    );
  }, [data?.assignedToAdminId, admins.data]);

  if (lead.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Lead</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Loading record…</p>
        </div>
        <GlassPanel className="h-24 animate-pulse" />
        <GlassPanel className="h-96 animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-sm text-[var(--color-biz-muted)]">Lead not found.</p>;
  }

  const followTone = followUpTone(data.nextFollowUpAt);

  const logCall = async () => {
    window.open(phoneHref(data.phone), "_self");
    await mutations.logActivity.mutateAsync({
      type: "CALL",
      title: `Call initiated — ${data.name}`,
      description: "Outbound call from lead detail",
    });
  };

  const logMessage = async () => {
    window.open(smsHref(data.phone), "_self");
    await mutations.logActivity.mutateAsync({
      type: "MESSAGE",
      title: `Message sent — ${data.name}`,
      description: "SMS / message from lead detail",
    });
  };

  return (
    <div className="space-y-6 pb-24 xl:pb-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link
            href="/partner-acquisition/leads"
            className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to CRM
          </Link>
          <div className="mt-3 flex items-start gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-biz-line)] bg-gradient-to-br from-[var(--color-biz-accent-dim)] to-transparent text-xl font-bold">
              {leadInitials(data.name)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold tracking-tight">{data.name}</h1>
                <LeadStatusChip status={data.status} />
              </div>
              <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
                {data.skillInterest ?? "General"} · {data.city ?? "—"} · {data.source.replace(/_/g, " ")}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <HeaderAction icon={Phone} label="Call" onClick={logCall} />
          <HeaderAction icon={MessageSquare} label="Message" onClick={logMessage} />
          <HeaderAction icon={UserPlus} label="Assign" onClick={() => setModal("assign")} />
          <HeaderAction icon={ArrowRightLeft} label="Status" onClick={() => setModal("status")} />
          <HeaderAction icon={CalendarClock} label="Follow-up" onClick={() => setModal("followUp")} primary={Boolean(data.provider)} />
          {!data.provider ? (
            <HeaderAction
              icon={PlayCircle}
              label="Start application"
              primary
              onClick={() => {
                setInvite(null);
                setStartError(null);
                setModal("start");
              }}
            />
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <GlassPanel className="p-4 lg:col-span-2">
          <LeadDetailPanel
            lead={data}
            assigneeName={assigneeName}
            notes={notesDraft}
            onNotesChange={setNotesDraft}
            onSaveNotes={() => mutations.updateNotes.mutate(notesDraft)}
            notesSaving={mutations.updateNotes.isPending}
            hideFullPageLink
            onStartApplication={() => {
              setInvite(null);
              setStartError(null);
              setModal("start");
            }}
            onResolveDuplicate={(candidate) => {
              setMergeCandidate(candidate);
              setModal("merge");
            }}
          />
        </GlassPanel>

        <div className="space-y-4">
          <GlassPanel className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              Assignment & follow-up
            </p>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <p className="text-[11px] uppercase text-[var(--color-biz-faint)]">Assigned to</p>
                <p className="font-semibold">{assigneeName ?? "Unassigned"}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase text-[var(--color-biz-faint)]">Next follow-up</p>
                <p
                  className={cn(
                    "font-semibold",
                    followTone === "overdue" && "text-[var(--color-biz-danger)]",
                    followTone === "today" && "text-[var(--color-biz-warning)]",
                    followTone === "upcoming" && "text-[var(--color-biz-cyan)]",
                  )}
                >
                  {formatFollowUp(data.nextFollowUpAt)}
                </p>
              </div>
            </div>
          </GlassPanel>

          <GlassPanel className="p-4">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              Full timeline
            </h2>
            <LeadTimeline activities={data.activities} />
          </GlassPanel>
        </div>
      </div>

      <LeadAssignModal
        open={modal === "assign"}
        currentAssigneeId={data.assignedToAdminId}
        isLoading={mutations.assign.isPending}
        onClose={() => setModal(null)}
        onConfirm={(adminId) => mutations.assign.mutate(adminId, { onSuccess: () => setModal(null) })}
      />
      <LeadStatusModal
        open={modal === "status"}
        leadId={params.id}
        currentStatus={data.status}
        isLoading={mutations.updateStatus.isPending}
        onClose={() => setModal(null)}
        onConfirm={(status, reason) =>
          mutations.updateStatus.mutate({ status, reason }, { onSuccess: () => setModal(null) })
        }
      />
      <LeadFollowUpModal
        open={modal === "followUp"}
        currentAt={data.nextFollowUpAt}
        currentReason={data.followUpReason}
        isLoading={mutations.setFollowUp.isPending}
        onClose={() => setModal(null)}
        onConfirm={(body) => mutations.setFollowUp.mutate(body, { onSuccess: () => setModal(null) })}
      />
      <LeadStartApplicationModal
        open={modal === "start"}
        leadName={data.name}
        phone={data.phone}
        applicationUrl={invite?.applicationUrl}
        smsBody={invite?.smsBody}
        expiresInDays={invite?.expiresInDays}
        isLoading={mutations.startApplication.isPending}
        error={startError}
        onClose={() => {
          setModal(null);
          setInvite(null);
          setStartError(null);
        }}
        onStart={() => {
          setStartError(null);
          mutations.startApplication.mutate(undefined, {
            onSuccess: (res) =>
              setInvite({
                applicationUrl: res.applicationUrl,
                smsBody: res.smsBody,
                expiresInDays: res.inviteExpiresInDays,
              }),
            onError: (err) => setStartError(err instanceof Error ? err.message : "Could not start application"),
          });
          }}
        />
      <LeadMergeModal
        open={modal === "merge"}
        primaryId={params.id}
        candidate={mergeCandidate}
        onClose={() => {
          setModal(null);
          setMergeCandidate(null);
        }}
        onMerged={() => {
          setModal(null);
          setMergeCandidate(null);
          void mutations.invalidate();
        }}
      />
    </div>
  );
}

function HeaderAction({
  icon: Icon,
  label,
  onClick,
  primary,
}: {
  icon: typeof Phone;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition",
        primary
          ? "bg-[var(--color-biz-accent)] text-black hover:brightness-110"
          : "border border-[var(--color-biz-line)] hover:border-[var(--color-biz-line-strong)]",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
