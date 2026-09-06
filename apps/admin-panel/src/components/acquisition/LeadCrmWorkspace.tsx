"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { GlassPanel } from "@/components/hq/GlassPanel";
import { SectionHead } from "@/components/hq/SectionHead";
import { LeadCard } from "@/components/acquisition/LeadCard";
import { LeadDetailPanel } from "@/components/acquisition/LeadDetailPanel";
import { LeadActionsPanel } from "@/components/acquisition/LeadActionsPanel";
import { LeadAssignModal } from "@/components/acquisition/LeadAssignModal";
import { LeadStatusModal } from "@/components/acquisition/LeadStatusModal";
import { LeadFollowUpModal } from "@/components/acquisition/LeadFollowUpModal";
import { LeadMobileActionSheet } from "@/components/acquisition/LeadMobileActionSheet";
import { LeadStartApplicationModal } from "@/components/acquisition/LeadStartApplicationModal";
import { LeadMergeModal } from "@/components/acquisition/LeadMergeModal";
import {
  LeadFilterDrawer,
  countApplied,
  toListQuery,
  type LeadAdvancedFilters,
} from "@/components/acquisition/LeadFilterDrawer";
import {
  useAdminUsers,
  usePartnerLeadDetail,
  usePartnerLeadList,
  usePartnerLeadMutations,
  partnerLeadKeys,
} from "@/hooks/use-partner-lead-crm";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { phoneHref, smsHref } from "@/lib/lead-crm-utils";
import { cn } from "@/lib/cn";
import type { PartnerDuplicateMatch, PartnerLeadStatus } from "@/services/admin-api";

const STATUS_FILTERS: Array<{ key: PartnerLeadStatus | "all"; label: string }> = [
  { key: "all", label: "All" },
  { key: "NEW", label: "New" },
  { key: "CONTACTED", label: "Contacted" },
  { key: "INTERESTED", label: "Interested" },
  { key: "APPLICATION_STARTED", label: "Application" },
  { key: "KYC_PENDING", label: "KYC" },
  { key: "VERIFICATION", label: "Verification" },
  { key: "TRAINING", label: "Training" },
  { key: "APPROVED", label: "Approved" },
  { key: "ACTIVATED", label: "Activated" },
  { key: "DORMANT", label: "Dormant" },
];

const FOLLOW_UP_FILTERS = [
  { key: "all" as const, label: "All follow-ups" },
  { key: "today" as const, label: "Today" },
  { key: "overdue" as const, label: "Overdue" },
  { key: "upcoming" as const, label: "Upcoming" },
  { key: "tomorrow" as const, label: "Tomorrow" },
  { key: "none" as const, label: "None set" },
];

type ModalKind = "assign" | "status" | "followUp" | "more" | "start" | "filters" | "merge" | null;

function parseAdvanced(sp: URLSearchParams): LeadAdvancedFilters {
  return {
    source: (sp.get("source") as LeadAdvancedFilters["source"]) || undefined,
    city: sp.get("city") || undefined,
    assignedTo: sp.get("assignedTo") || undefined,
    skill: sp.get("skill") || undefined,
    zone: sp.get("zone") || undefined,
    campaign: sp.get("campaign") || undefined,
    minScore: sp.get("minScore") || undefined,
    maxScore: sp.get("maxScore") || undefined,
    createdFrom: sp.get("createdFrom") || undefined,
    createdTo: sp.get("createdTo") || undefined,
    lastActivityFrom: sp.get("lastActivityFrom") || undefined,
    lastActivityTo: sp.get("lastActivityTo") || undefined,
  };
}

export function LeadCrmWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const urlLeadId = searchParams.get("lead");

  const [status, setStatus] = useState<PartnerLeadStatus | "all">(
    (searchParams.get("status") as PartnerLeadStatus) || "all",
  );
  const [followUp, setFollowUp] = useState<"all" | "today" | "overdue" | "upcoming" | "tomorrow" | "none">(
    (searchParams.get("followUp") as "today" | "overdue" | "upcoming" | "tomorrow" | "none") || "all",
  );
  const [stalled, setStalled] = useState(searchParams.get("stalled") === "true");
  const [noNextAction, setNoNextAction] = useState(searchParams.get("noNextAction") === "true");
  const [search, setSearch] = useState(searchParams.get("search") ?? "");
  const [advanced, setAdvanced] = useState<LeadAdvancedFilters>(() => parseAdvanced(searchParams));
  const [draftAdvanced, setDraftAdvanced] = useState<LeadAdvancedFilters>(() => parseAdvanced(searchParams));
  const [page, setPage] = useState(Number(searchParams.get("page") ?? "1") || 1);
  const debouncedSearch = useDebouncedValue(search, 300);
  const [selectedId, setSelectedId] = useState<string | undefined>(urlLeadId ?? undefined);
  const [modal, setModal] = useState<ModalKind>(null);
  const [mergeCandidate, setMergeCandidate] = useState<PartnerDuplicateMatch | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [invite, setInvite] = useState<{ applicationUrl: string; smsBody: string; expiresInDays: number } | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  const listQuery = usePartnerLeadList({
    status: status !== "all" ? status : undefined,
    followUp: followUp !== "all" ? followUp : undefined,
    stalled: stalled ? "true" : undefined,
    noNextAction: noNextAction ? "true" : undefined,
    search: debouncedSearch || undefined,
    page,
    limit: 50,
    ...toListQuery(advanced),
  });

  const leads = listQuery.data?.leads ?? [];
  const detailQuery = usePartnerLeadDetail(selectedId);
  const admins = useAdminUsers();
  const mutations = usePartnerLeadMutations(selectedId);
  const advancedCount = countApplied(advanced);
  const assigneeOptions = useMemo(
    () =>
      (admins.data ?? []).map((a) => ({
        id: a.id,
        label: [a.user?.firstName, a.user?.lastName].filter(Boolean).join(" ") || a.user?.email || a.id.slice(0, 8),
      })),
    [admins.data],
  );

  useEffect(() => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (followUp !== "all") params.set("followUp", followUp);
    if (stalled) params.set("stalled", "true");
    if (noNextAction) params.set("noNextAction", "true");
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (page > 1) params.set("page", String(page));
    Object.entries(advanced).forEach(([k, v]) => {
      if (v) params.set(k, v);
    });
    if (selectedId) params.set("lead", selectedId);
    const next = params.toString();
    const current = searchParams.toString();
    if (next !== current) {
      router.replace(next ? `/partner-acquisition/leads?${next}` : "/partner-acquisition/leads", { scroll: false });
    }
  }, [status, followUp, stalled, noNextAction, debouncedSearch, page, advanced, selectedId, router, searchParams]);

  useEffect(() => {
    if (urlLeadId) setSelectedId(urlLeadId);
  }, [urlLeadId]);

  useEffect(() => {
    if (!selectedId && leads.length > 0 && typeof window !== "undefined" && window.innerWidth >= 1280) {
      setSelectedId(leads[0]!.id);
    }
  }, [leads, selectedId]);

  useEffect(() => {
    if (detailQuery.data) setNotesDraft(detailQuery.data.notes ?? "");
  }, [detailQuery.data?.id, detailQuery.data?.notes]);

  const assigneeName = useMemo(() => {
    const id = detailQuery.data?.assignedToAdminId;
    if (!id) return undefined;
    const admin = admins.data?.find((a) => a.id === id);
    if (!admin) return id.slice(0, 8);
    return (
      [admin.user?.firstName, admin.user?.lastName].filter(Boolean).join(" ") || admin.user?.email || id
    );
  }, [detailQuery.data?.assignedToAdminId, admins.data]);

  const selectLead = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const logContact = useCallback(
    async (leadId: string, name: string, phone: string, type: "CALL" | "MESSAGE") => {
      window.open(type === "CALL" ? phoneHref(phone) : smsHref(phone), "_self");
      const { adminApi } = await import("@/services/admin-api");
      await adminApi.partnerAcquisition.logActivity(leadId, {
        type,
        title: type === "CALL" ? `Call initiated — ${name}` : `Message sent — ${name}`,
        description: type === "CALL" ? "Outbound call from CRM" : "SMS / message from CRM",
      });
      await qc.invalidateQueries({ queryKey: partnerLeadKeys.all });
      await qc.invalidateQueries({ queryKey: partnerLeadKeys.detail(leadId) });
    },
    [qc],
  );
  const logCall = useCallback(async () => {
    if (!selectedId || !detailQuery.data) return;
    await logContact(selectedId, detailQuery.data.name, detailQuery.data.phone, "CALL");
  }, [selectedId, detailQuery.data, logContact]);

  const logMessage = useCallback(async () => {
    if (!selectedId || !detailQuery.data) return;
    await logContact(selectedId, detailQuery.data.name, detailQuery.data.phone, "MESSAGE");
  }, [selectedId, detailQuery.data, logContact]);

  const mobileDetailOpen = Boolean(selectedId);

  return (
    <div className="space-y-6">
      <SectionHead
        as="h1"
        title="Lead CRM"
        subtitle="Manage partner acquisition pipeline from first contact to activation."
        action={
          <Link
            href="/partner-acquisition/leads/new"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
          >
            <Plus className="h-4 w-4" />
            Add Lead
          </Link>
        }
      />

      <GlassPanel className="p-4">
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-biz-muted)]" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, phone, email…"
              className="w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-elevated)] py-2.5 pl-10 pr-3 text-sm outline-none ring-[var(--color-biz-accent)] focus:ring-2"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                active={status === f.key}
                onClick={() => {
                  setStatus(f.key);
                  setPage(1);
                }}
                label={f.label}
              />
            ))}
            <button
              type="button"
              onClick={() => {
                setDraftAdvanced(advanced);
                setModal("filters");
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filters{advancedCount ? ` · ${advancedCount}` : ""}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-biz-line)] pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-biz-faint)]">
              Follow-ups
            </span>
            {FOLLOW_UP_FILTERS.map((f) => (
              <FilterChip
                key={f.key}
                active={followUp === f.key && !stalled && !noNextAction}
                onClick={() => {
                  setFollowUp(f.key);
                  setStalled(false);
                  setNoNextAction(false);
                  setPage(1);
                }}
                label={f.label}
                variant="cyan"
              />
            ))}
            <FilterChip
              active={stalled}
              onClick={() => {
                setStalled((v) => !v);
                setPage(1);
              }}
              label="Stalled"
              variant="cyan"
            />
            <FilterChip
              active={noNextAction}
              onClick={() => {
                setNoNextAction((v) => !v);
                setPage(1);
              }}
              label="No next action"
              variant="cyan"
            />
          </div>
          {advancedCount ? (
            <div className="flex flex-wrap gap-2">
              {Object.entries(advanced)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setAdvanced((prev) => ({ ...prev, [k]: undefined }));
                      setPage(1);
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-[var(--color-biz-elevated)] px-2.5 py-1 text-[11px] font-semibold"
                  >
                    {k}: {v}
                    <X className="h-3 w-3" />
                  </button>
                ))}
              <button
                type="button"
                onClick={() => {
                  setAdvanced({});
                  setPage(1);
                }}
                className="text-xs font-semibold text-[var(--color-biz-accent)]"
              >
                Clear all
              </button>
            </div>
          ) : null}
        </div>
      </GlassPanel>

      <div className="grid min-h-[620px] gap-4 xl:grid-cols-[380px_minmax(0,1fr)_340px]">
        {/* Lead list */}
        <GlassPanel
          className={cn("overflow-hidden p-0", mobileDetailOpen && "hidden xl:block")}
        >
          <div className="flex items-center justify-between border-b border-[var(--color-biz-line)] px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
              {listQuery.isLoading ? "Loading leads" : `${listQuery.data?.total ?? 0} leads`}
            </span>
            {listQuery.isFetching ? (
              <span className="text-[10px] text-[var(--color-biz-faint)]">Updating…</span>
            ) : null}
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {listQuery.isLoading ? (
              <ListSkeleton />
            ) : leads.length === 0 ? (
              <EmptyList />
            ) : (
              leads.map((lead) => (
                <LeadCard
                  key={lead.id}
                  lead={lead}
                  selected={lead.id === selectedId}
                  onSelect={() => selectLead(lead.id)}
                  onAssign={() => {
                    selectLead(lead.id);
                    setModal("assign");
                  }}
                  onCall={async () => {
                    selectLead(lead.id);
                    await logContact(lead.id, lead.name, lead.phone, "CALL");
                  }}
                  onMessage={async () => {
                    selectLead(lead.id);
                    await logContact(lead.id, lead.name, lead.phone, "MESSAGE");
                  }}
                />
              ))
            )}
          </div>
          {(listQuery.data?.total ?? 0) > 50 ? (
            <div className="flex items-center justify-between border-t border-[var(--color-biz-line)] px-4 py-2 text-xs">
              <button type="button" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="font-semibold disabled:opacity-40">
                Previous
              </button>
              <span>Page {page}</span>
              <button
                type="button"
                disabled={page * 50 >= (listQuery.data?.total ?? 0)}
                onClick={() => setPage((p) => p + 1)}
                className="font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          ) : null}
        </GlassPanel>

        {/* Detail + actions */}
        <div className={cn("grid gap-4 xl:col-span-2 xl:grid-cols-[1fr_340px]", !mobileDetailOpen && "hidden xl:grid")}>
          <GlassPanel className="p-5 xl:p-6">
            {mobileDetailOpen ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedId(undefined);
                }}
                className="mb-4 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)] xl:hidden"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to list
              </button>
            ) : null}

            {detailQuery.isLoading && selectedId ? (
              <DetailSkeleton />
            ) : detailQuery.data ? (
              <LeadDetailPanel
                lead={detailQuery.data}
                assigneeName={assigneeName}
                notes={notesDraft}
                onNotesChange={setNotesDraft}
                onSaveNotes={() => mutations.updateNotes.mutate(notesDraft)}
                notesSaving={mutations.updateNotes.isPending}
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
            ) : (
              <EmptyDetail />
            )}
          </GlassPanel>

          <GlassPanel className="hidden p-4 xl:block">
            {detailQuery.data ? (
              <LeadActionsPanel
                lead={detailQuery.data}
                assigneeName={assigneeName}
                onAssign={() => setModal("assign")}
                onStatus={() => setModal("status")}
                onFollowUp={() => setModal("followUp")}
                onCall={logCall}
                onMessage={logMessage}
                onStartApplication={() => {
                  setInvite(null);
                  setStartError(null);
                  setModal("start");
                }}
              />
            ) : (
              <p className="text-sm text-[var(--color-biz-muted)]">Select a lead for actions.</p>
            )}
          </GlassPanel>
        </div>

        {/* Mobile action bar */}
        {detailQuery.data && mobileDetailOpen ? (
          <div className="fixed inset-x-0 bottom-0 z-50 border-t border-[var(--color-biz-line)] bg-[var(--color-biz-surface)]/95 p-3 backdrop-blur-xl xl:hidden">
            <div className="grid grid-cols-4 gap-2">
              <MobileAction label="Call" onClick={logCall} />
              <MobileAction label="Message" onClick={logMessage} />
              <MobileAction label="Assign" onClick={() => setModal("assign")} />
              <MobileAction label="More" onClick={() => setModal("more")} />
            </div>
          </div>
        ) : null}
      </div>

      {selectedId && detailQuery.data ? (
        <>
          <LeadAssignModal
            open={modal === "assign"}
            currentAssigneeId={detailQuery.data.assignedToAdminId}
            isLoading={mutations.assign.isPending}
            onClose={() => setModal(null)}
            onConfirm={(adminId) =>
              mutations.assign.mutate(adminId, { onSuccess: () => setModal(null) })
            }
          />
          <LeadStatusModal
            open={modal === "status"}
            leadId={selectedId}
            currentStatus={detailQuery.data.status}
            isLoading={mutations.updateStatus.isPending}
            onClose={() => setModal(null)}
            onConfirm={(status, reason) =>
              mutations.updateStatus.mutate(
                { status, reason },
                { onSuccess: () => setModal(null) },
              )
            }
          />
          <LeadFollowUpModal
            open={modal === "followUp"}
            currentAt={detailQuery.data.nextFollowUpAt}
            currentReason={detailQuery.data.followUpReason}
            isLoading={mutations.setFollowUp.isPending}
            onClose={() => setModal(null)}
            onConfirm={(body) =>
              mutations.setFollowUp.mutate(body, { onSuccess: () => setModal(null) })
            }
          />
          <LeadMobileActionSheet
            open={modal === "more"}
            showStartApplication={!detailQuery.data.provider}
            onClose={() => setModal(null)}
            onStatus={() => setModal("status")}
            onFollowUp={() => setModal("followUp")}
            onStartApplication={() => {
              setInvite(null);
              setStartError(null);
              setModal("start");
            }}
          />
          <LeadStartApplicationModal
            open={modal === "start"}
            leadName={detailQuery.data.name}
            phone={detailQuery.data.phone}
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
                onSuccess: (data) =>
                  setInvite({
                    applicationUrl: data.applicationUrl,
                    smsBody: data.smsBody,
                    expiresInDays: data.inviteExpiresInDays,
                  }),
                onError: (err) => setStartError(err instanceof Error ? err.message : "Could not start application"),
              });
            }}
          />
          <LeadMergeModal
            open={modal === "merge"}
            primaryId={selectedId}
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
        </>
      ) : null}
      <LeadFilterDrawer
        open={modal === "filters"}
        value={draftAdvanced}
        assignees={assigneeOptions}
        onChange={setDraftAdvanced}
        onApply={() => {
          setAdvanced(draftAdvanced);
          setPage(1);
          setModal(null);
        }}
        onReset={() => {
          setDraftAdvanced({});
          setAdvanced({});
          setPage(1);
        }}
        onClose={() => setModal(null)}
      />
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
  variant,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  variant?: "cyan";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold transition duration-200",
        active
          ? variant === "cyan"
            ? "bg-[var(--color-biz-cyan-dim)] text-[var(--color-biz-cyan)] ring-1 ring-[var(--color-biz-cyan)]/30"
            : "bg-[var(--color-biz-accent)] text-black"
          : "bg-[var(--color-biz-elevated)] text-[var(--color-biz-muted)] ring-1 ring-[var(--color-biz-line)] hover:ring-[var(--color-biz-line-strong)]",
      )}
    >
      {label}
    </button>
  );
}

function MobileAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-[var(--color-biz-line)] py-2.5 text-xs font-semibold"
    >
      {label}
    </button>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="h-14 w-14 animate-pulse rounded-2xl bg-[var(--color-biz-elevated)]" />
        <div className="flex-1 space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-[var(--color-biz-elevated)]" />
          <div className="h-4 w-64 animate-pulse rounded bg-[var(--color-biz-elevated)]" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-[var(--color-biz-elevated)]" />
        ))}
      </div>
    </div>
  );
}

function EmptyList() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">No leads yet</p>
      <p className="mt-1 text-sm text-[var(--color-biz-muted)]">
        Once acquisition channels start generating leads, they&apos;ll appear here.
      </p>
      <Link
        href="/partner-acquisition/leads/new"
        className="mt-4 inline-flex rounded-xl bg-[var(--color-biz-accent)] px-4 py-2 text-sm font-semibold text-black"
      >
        Add Lead
      </Link>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="flex h-full min-h-[320px] flex-col items-center justify-center text-center">
      <p className="text-sm font-medium">Select a lead to view details</p>
      <p className="mt-1 max-w-xs text-xs text-[var(--color-biz-muted)]">
        Choose a lead from the list to see profile, timeline, and CRM actions.
      </p>
    </div>
  );
}
