"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  RefreshCw,
  ShieldAlert,
  User,
  XCircle,
} from "lucide-react";
import { adminApi, type PendingPartnerDocument } from "@/services/admin-api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { getErrorMessage } from "@/lib/api-error";
import { resolveApiBase } from "@/lib/api-base";

function partnerLabel(doc: PendingPartnerDocument) {
  const u = doc.provider.user;
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return doc.provider.businessName || name || u.email || doc.provider.id.slice(0, 8);
}

function docTypeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function VendorDocumentsPage() {
  const qc = useQueryClient();
  const [rejectTarget, setRejectTarget] = useState<PendingPartnerDocument | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ["admin", "documents", "pending"],
    queryFn: () => adminApi.pendingDocuments(),
    refetchInterval: 60_000,
  });

  const documents = queue.data?.documents ?? [];
  const apiBase = resolveApiBase();

  const verifyMutation = useMutation({
    mutationFn: ({ providerId, docId }: { providerId: string; docId: string }) =>
      adminApi.verifyPartnerDocument(providerId, docId),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: ["admin", "documents", "pending"] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const rejectMutation = useMutation({
    mutationFn: ({
      providerId,
      docId,
      reason,
    }: {
      providerId: string;
      docId: string;
      reason: string;
    }) => adminApi.rejectPartnerDocument(providerId, docId, reason),
    onSuccess: () => {
      setActionError(null);
      setRejectTarget(null);
      void qc.invalidateQueries({ queryKey: ["admin", "documents", "pending"] });
    },
    onError: (err) => setActionError(getErrorMessage(err)),
  });

  const stats = useMemo(() => {
    const types = new Set(documents.map((d) => d.documentType));
    const oldest = documents.reduce<string | null>((acc, d) => {
      if (!acc) return d.uploadedAt;
      return new Date(d.uploadedAt) < new Date(acc) ? d.uploadedAt : acc;
    }, null);
    return { count: documents.length, types: types.size, oldest };
  }, [documents]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <FileText className="h-7 w-7 text-primary" />
            Partner Document Review
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            KYC and compliance queue — approve or reject partner uploads with full audit trail. Data from{" "}
            <code className="rounded bg-muted px-1 text-xs">GET /api/admin/documents/pending</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void queue.refetch()}
          disabled={queue.isFetching}
          className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm font-medium shadow-sm transition hover:bg-muted/50 disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${queue.isFetching ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border bg-card p-5 shadow-sm">
          <ShieldAlert className="h-5 w-5 text-amber-500" />
          <p className="mt-3 text-2xl font-bold">{stats.count}</p>
          <p className="text-sm text-muted-foreground">Pending review</p>
        </article>
        <article className="rounded-xl border bg-card p-5 shadow-sm">
          <FileText className="h-5 w-5 text-primary" />
          <p className="mt-3 text-2xl font-bold">{stats.types}</p>
          <p className="text-sm text-muted-foreground">Document types</p>
        </article>
        <article className="rounded-xl border bg-card p-5 shadow-sm">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-sm font-bold">
            {stats.oldest ? new Date(stats.oldest).toLocaleString("en-IN") : "—"}
          </p>
          <p className="text-sm text-muted-foreground">Oldest in queue</p>
        </article>
      </div>

      {actionError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError}
        </div>
      ) : null}

      {queue.isLoading ? (
        <div className="rounded-xl border bg-card p-12 text-center text-sm text-muted-foreground">
          Loading document queue…
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-card p-12 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <p className="mt-3 font-semibold">Queue clear</p>
          <p className="mt-1 text-sm text-muted-foreground">No partner documents awaiting verification.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const fileUrl = doc.documentUrl.startsWith("http")
              ? doc.documentUrl
              : `${apiBase}${doc.documentUrl}`;
            const busy =
              verifyMutation.isPending || rejectMutation.isPending;
            return (
              <article
                key={doc.id}
                className="rounded-xl border bg-card p-5 shadow-sm transition hover:border-primary/30"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        {docTypeLabel(doc.documentType)}
                      </span>
                      {doc.documentName ? (
                        <span className="text-sm font-medium">{doc.documentName}</span>
                      ) : null}
                    </div>
                    <p className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <Link
                        href={`/vendors/${doc.providerId}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {partnerLabel(doc)}
                      </Link>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Uploaded {new Date(doc.uploadedAt).toLocaleString("en-IN")}
                      {doc.expiryDate
                        ? ` · Expires ${new Date(doc.expiryDate).toLocaleDateString("en-IN")}`
                        : ""}
                    </p>
                    {doc.verificationNotes ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        Note: {doc.verificationNotes}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition hover:bg-muted/50"
                    >
                      <ExternalLink className="h-4 w-4" />
                      View file
                    </a>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        verifyMutation.mutate({
                          providerId: doc.providerId,
                          docId: doc.id,
                        })
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRejectTarget(doc)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-2 text-sm font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-60"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(rejectTarget)}
        title="Reject document"
        description="The partner will need to re-upload. This action is recorded in verification notes."
        confirmLabel="Reject document"
        destructive
        isLoading={rejectMutation.isPending}
        reasonLabel="Rejection reason"
        reasonPlaceholder="Explain what needs to be corrected…"
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => {
          if (!rejectTarget || !reason?.trim()) {
            setActionError("Please enter a rejection reason.");
            return;
          }
          rejectMutation.mutate({
            providerId: rejectTarget.providerId,
            docId: rejectTarget.id,
            reason: reason.trim(),
          });
        }}
      />
    </div>
  );
}
