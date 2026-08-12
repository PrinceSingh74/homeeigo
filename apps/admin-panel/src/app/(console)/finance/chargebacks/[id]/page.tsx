"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Download, FileBadge, Upload } from "lucide-react";
import { DataTable, StatusBadge } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { adminApi } from "@/services/admin-api";
import { arrayBufferToBase64 } from "@/lib/file-encoding";
import { getErrorMessage } from "@/lib/api-error";
import { inr } from "@/lib/format";

export default function ChargebackDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [resolveOutcome, setResolveOutcome] = useState<"WON" | "LOST" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "finance", "chargeback", id],
    queryFn: () => adminApi.getChargebackDetail(id),
    enabled: !!id,
  });

  const { data: pkgData } = useQuery({
    queryKey: ["admin", "finance", "chargeback-package", id],
    queryFn: () => adminApi.getChargebackEvidencePackage(id),
    enabled: !!id,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "finance", "chargeback", id] });
    void qc.invalidateQueries({ queryKey: ["admin", "finance", "chargebacks"] });
  };

  const [downloadError, setDownloadError] = useState<string | null>(null);

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const base64 = arrayBufferToBase64(buffer);
      return adminApi.uploadChargebackEvidence(id, base64, file.name);
    },
    onSuccess: invalidate,
  });

  const downloadMut = useMutation({
    mutationFn: ({ evidenceId, fileName }: { evidenceId: string; fileName: string }) =>
      adminApi.downloadChargebackEvidence(evidenceId, fileName),
    onMutate: () => setDownloadError(null),
    onError: (err) => setDownloadError(getErrorMessage(err)),
  });

  const legalPackMut = useMutation({
    mutationFn: () => adminApi.downloadChargebackLegalEvidencePack(id),
    onMutate: () => setDownloadError(null),
    onError: (err) => setDownloadError(getErrorMessage(err)),
  });

  const resolveMut = useMutation({
    mutationFn: ({ outcome, notes }: { outcome: "WON" | "LOST"; notes?: string }) =>
      adminApi.resolveChargeback(id, outcome, notes),
    onSuccess: () => { setResolveOutcome(null); invalidate(); },
  });

  const cb = (data?.chargeback ?? {}) as Record<string, unknown>;
  const evidence = (cb.evidence as Array<Record<string, unknown>>) ?? [];
  const timeline = (cb.timeline as Array<Record<string, unknown>>) ?? [];
  const pkg = pkgData?.package as Record<string, unknown> | undefined;

  const evidenceRows = evidence.map((e) => [
    String(e.fileName ?? "—"),
    String(e.mimeType ?? "—"),
    new Date(String(e.createdAt)).toLocaleString(),
    <button
      key={`dl-${e.id}`}
      type="button"
      className="text-xs text-[var(--color-biz-accent)]"
      onClick={() =>
        downloadMut.mutate({ evidenceId: String(e.id), fileName: String(e.fileName ?? "evidence") })
      }
    >
      Download
    </button>,
  ]);

  const timelineRows = timeline.map((t) => [
    new Date(String(t.createdAt)).toLocaleString(),
    String(t.action ?? "—"),
    String(t.details ?? "—"),
  ]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/finance/chargebacks" className="rounded-lg border p-2 hover:bg-[var(--color-biz-elevated)]">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Chargeback {String(cb.razorpayDisputeId ?? id).slice(0, 16)}</h1>
          <p className="text-sm text-[var(--color-biz-muted)]">Evidence management and dispute resolution</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <KpiCard label="Status" value={String(cb.displayStatus ?? cb.status ?? "—")} loading={isLoading} />
        <KpiCard label="Amount" value={inr(Number(cb.amount ?? 0), true)} loading={isLoading} />
        <KpiCard label="Days remaining" value={cb.daysRemaining != null ? `${cb.daysRemaining}d` : "—"} loading={isLoading} />
        <KpiCard label="Evidence files" value={String(evidence.length)} loading={isLoading} />
      </div>

      <div className="biz-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Evidence upload</h2>
          <div className="flex gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) uploadMut.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploadMut.isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-primary)] px-3 py-1.5 text-sm text-white"
            >
              <Upload className="h-4 w-4" /> Upload (PDF/PNG/JPG/ZIP)
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
              onClick={() => setResolveOutcome("WON")}
            >
              Mark Won
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-red-400/50 px-3 py-1.5 text-sm text-red-400"
              onClick={() => setResolveOutcome("LOST")}
            >
              Mark Lost
            </button>
          </div>
        </div>
      </div>

      {pkg && (
        <div className="biz-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold flex items-center gap-2">
              <FileBadge className="h-4 w-4 text-[var(--color-biz-accent)]" /> Legal evidence pack
            </h2>
            <button
              type="button"
              disabled={legalPackMut.isPending}
              onClick={() => legalPackMut.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-biz-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {legalPackMut.isPending ? "Generating…" : "Download legal evidence pack"}
            </button>
          </div>
          <p className="text-xs text-[var(--color-biz-muted)]">
            Enterprise-certified PDF with case summary, transaction record, evidence manifest, timeline, and legal
            attestation — ready for acquirer submission.
          </p>
          <div className="grid gap-2 rounded-lg bg-[var(--color-biz-bg)] p-3 text-xs sm:grid-cols-3">
            <div>
              <p className="font-semibold text-[var(--color-biz-muted)]">Booking</p>
              <p className="mt-0.5 text-[var(--color-biz-text)]">
                {(pkg.booking as { bookingNumber?: string } | null)?.bookingNumber ?? "Not linked to platform booking"}
              </p>
              {(pkg.booking as { service?: string } | null)?.service ? (
                <p className="text-[var(--color-biz-muted)]">{(pkg.booking as { service: string }).service}</p>
              ) : null}
            </div>
            <div>
              <p className="font-semibold text-[var(--color-biz-muted)]">Payment</p>
              <p className="mt-0.5 text-[var(--color-biz-text)]">
                {(pkg.payment as { razorpayPaymentId?: string } | null)?.razorpayPaymentId ?? "Not linked to payment"}
              </p>
              {(pkg.payment as { amountPaid?: number } | null)?.amountPaid != null ? (
                <p className="text-[var(--color-biz-muted)]">{inr(Number((pkg.payment as { amountPaid: number }).amountPaid), true)}</p>
              ) : null}
            </div>
            <div>
              <p className="font-semibold text-[var(--color-biz-muted)]">Evidence</p>
              <p className="mt-0.5 text-[var(--color-biz-text)]">
                {(pkg.evidence as unknown[])?.length ?? 0} file(s) indexed
              </p>
              <p className="text-[var(--color-biz-muted)]">
                {(pkg.linkage as { paymentLinked?: boolean } | undefined)?.paymentLinked
                  ? "Platform record linked"
                  : "Upload-only case — link payment to enrich pack"}
              </p>
            </div>
          </div>
        </div>
      )}

      <DataTable title="Evidence files" headers={["File", "Type", "Uploaded", ""]} rows={evidenceRows} loading={isLoading} emptyMessage="No evidence uploaded" />
      {downloadError ? (
        <p className="text-sm text-red-400">{downloadError}</p>
      ) : null}
      <DataTable title="Timeline" headers={["When", "Action", "Details"]} rows={timelineRows} loading={isLoading} emptyMessage="No timeline events" />

      <ConfirmDialog
        open={!!resolveOutcome}
        title={`Resolve as ${resolveOutcome}`}
        description="This records the dispute outcome and updates analytics."
        reasonLabel="Resolution notes"
        confirmLabel={`Confirm ${resolveOutcome}`}
        destructive={resolveOutcome === "LOST"}
        isLoading={resolveMut.isPending}
        onClose={() => setResolveOutcome(null)}
        onConfirm={(notes) => { if (resolveOutcome) resolveMut.mutate({ outcome: resolveOutcome, notes }); }}
      />
    </div>
  );
}
