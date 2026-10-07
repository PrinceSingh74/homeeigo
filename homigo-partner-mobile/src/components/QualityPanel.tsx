import { useQuery } from "@tanstack/react-query";
import { ImageOff } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { BulletList, PanelError, SubHeading } from "@/components/job/parts";
import { Banner, T } from "@/components/ui";
import { warrantyLine } from "@/lib/warranty";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { color, radius, space } from "@/theme/tokens";

/**
 * Phase 10 §10/§11 — the quality result of this job (compact mirror of partner web's QualityPanel):
 * the server's recorded verdict with its reason codes in words (after a refused completion, this IS
 * the refusal), the customer-confirmation state, the warranty window, and the customer's reported
 * issues (read-only: description and outcome only — the server sends no money or admin detail, and
 * none is invented).
 *
 * Draws nothing when the server has recorded nothing; a failed load says so with a retry.
 */

const VERDICT_LABEL: Record<string, string> = {
  PASS: "Passed quality checks",
  PASS_WITH_EXCEPTION: "Passed. An optional step was skipped with a reason",
  REWORK_REQUIRED: "Rework required before this job can be completed",
  ESCALATED: "Under review. Completion is blocked",
  FAILED: "Did not meet the standard",
};
const BLOCKING = new Set(["REWORK_REQUIRED", "ESCALATED", "FAILED"]);

const REASON_LABEL: Record<string, string> = {
  SAFETY_HOLD_ACTIVE: "A safety hold is active. Only the safety team can clear it",
  SAFETY_INCIDENT_OPEN: "A safety incident is open on this job",
  EXECUTION_STEP_ESCALATED: "A work step is with the support team for review",
  EXECUTION_STEP_FAILED: "A work step failed and needs to be redone",
  QUALITY_PROOF_REQUIRED: "Required proof photos are missing",
  QUALITY_CHECKLIST_REQUIRED: "The service checklist is not complete",
  QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED: "The completion criteria were not confirmed by the professional",
  EXECUTION_STEP_INCOMPLETE: "Required work steps are not finished",
  EXECUTION_STEP_SKIPPED: "An optional step was skipped with a reason",
  NO_QUALITY_POLICY: "No quality checks are configured for this service",
  ADMIN_OVERRIDE: "Recorded by an administrator",
};

const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "Quality of the work",
  INCOMPLETE: "Work left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "Behaviour",
  NO_SHOW: "No show",
  BILLING: "Billing or payment",
  OTHER: "Other",
};

const CASE_STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Coverage check",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed, not upheld",
  ESCALATED: "With the senior team",
};

const CASE_ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "Resolved by the support team",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "Closed, no action",
  NONE: "Closed, no further action",
};

const dt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function QualityPanel({ bookingId, enabled = true }: { bookingId: string; enabled?: boolean }) {
  const on = !!bookingId && enabled;
  const quality = useQuery({ queryKey: ["partner", "quality", bookingId], queryFn: () => partnerApi.getQuality(bookingId), enabled: on, staleTime: 10_000 });
  const completion = useQuery({ queryKey: ["partner", "completion", bookingId], queryFn: () => partnerApi.getCompletion(bookingId), enabled: on, staleTime: 10_000 });
  const cases = useQuery({ queryKey: ["partner", "cases", bookingId], queryFn: () => partnerApi.getCases(bookingId), enabled: on, staleTime: 10_000 });

  const latest = quality.data?.latest ?? null;
  const history = quality.data?.history ?? [];
  const lastEntry = history.length ? history[history.length - 1] : undefined;
  const missing = lastEntry ? lastEntry.missingChecklistItems : [];
  const comp = completion.data?.completion ?? null;
  const warranty = warrantyLine(completion.data?.warranty, new Date(), dt);
  const caseList = cases.data?.available ? cases.data.cases : [];
  const failed = [quality, completion, cases].find((q) => q.isError && !q.data);

  if (!latest && !comp && caseList.length === 0 && !warranty) {
    // A failed read must not look like "nothing recorded".
    if (!failed) return null;
    return (
      <View style={styles.block}>
        <PanelError
          error={failed.error}
          retrying={quality.isFetching || completion.isFetching || cases.isFetching}
          onRetry={() => {
            void quality.refetch();
            void completion.refetch();
            void cases.refetch();
          }}
          testID="quality-load-error"
        />
      </View>
    );
  }
  const blocking = !!latest && BLOCKING.has(latest.verdict);

  return (
    <View testID="quality-panel" style={styles.block}>
      <SubHeading>Quality result</SubHeading>
      {latest ? (
        <View testID="quality-verdict" style={styles.group}>
          {blocking ? (
            <Banner tone="warning" message={`${VERDICT_LABEL[latest.verdict] ?? latest.verdict} · ${dt(latest.at)}`} />
          ) : (
            <T kind="bodyStrong">{`${VERDICT_LABEL[latest.verdict] ?? latest.verdict} · ${dt(latest.at)}`}</T>
          )}
          <BulletList items={latest.reasonCodes.map((c) => REASON_LABEL[c] ?? c)} tone={blocking ? "warning" : undefined} />
          {blocking && missing.length ? <T kind="small" tone="warning">{`Checklist still open: ${missing.join(", ")}`}</T> : null}
        </View>
      ) : null}

      {comp ? (
        <T kind="body" tone="slate" testID="quality-completion">
          {comp.state === "PENDING_CUSTOMER"
            ? `Waiting for the customer to confirm. It confirms automatically by ${dt(comp.confirmBy)}.`
            : comp.state === "CONFIRMED"
              ? `The customer confirmed this job${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
              : comp.state === "AUTO_CONFIRMED"
                ? `This job was confirmed automatically${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
                : comp.state === "ISSUE_REPORTED"
                  ? "The customer reported an issue. See below."
                  : comp.state}
        </T>
      ) : null}

      {warranty ? (
        <T kind="body" tone="slate" testID="quality-warranty">
          {warranty}
        </T>
      ) : null}

      {caseList.length ? (
        <View style={styles.group} testID="quality-cases">
          <SubHeading>Reported issues</SubHeading>
          {caseList.map((k) => {
            const stored = (k.evidence ?? []).filter((e) => e.hasStoredMedia);
            return (
              <View key={k.id} style={styles.group} testID={`quality-case-${k.caseNumber}`}>
                <T kind="bodyStrong">{`${CATEGORY_LABEL[k.category] ?? k.category} · ${k.caseNumber} · ${CASE_STATE_LABEL[k.state] ?? k.state}`}</T>
                {k.description ? <T kind="body" tone="slate">{k.description}</T> : null}
                {stored.length ? (
                  <View style={styles.photos} testID={`quality-case-photos-${k.caseNumber}`}>
                    {stored.map((e, i) => (
                      <CasePhoto key={e.id} bookingId={bookingId} caseId={k.id} evidenceId={e.id} label={`Customer photo ${i + 1} for ${k.caseNumber}`} />
                    ))}
                  </View>
                ) : null}
                {k.resolution?.action ? <T kind="small">{`${CASE_ACTION_LABEL[String(k.resolution.action)] ?? "Resolved"}.`}</T> : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One photo the customer attached to a reported issue. The media route is private, so the image is
 * requested with the partner's own bearer token (`partnerApi.caseEvidenceImageSource`), rebuilt when
 * the token is refreshed. An `Image` cannot refresh-and-retry on a 401, so a photo that does not load
 * (expired token, removed object) falls back to words — the attachment is never silently dropped.
 */
function CasePhoto({ bookingId, caseId, evidenceId, label }: { bookingId: string; caseId: string; evidenceId: number; label: string }) {
  const token = useAuthStore((s) => s.accessToken);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token]);
  const source = partnerApi.caseEvidenceImageSource(bookingId, caseId, evidenceId, token);
  if (!source || failed) {
    return (
      <View style={[styles.photo, styles.photoFallback]} accessible accessibilityLabel={`${label}: attached, could not be shown`}>
        <ImageOff color={color.slate} size={20} />
        <T kind="caption" style={styles.center}>
          Attached, not shown
        </T>
      </View>
    );
  }
  return <Image source={source} onError={() => setFailed(true)} accessibilityRole="image" accessibilityLabel={label} resizeMode="cover" style={styles.photo} />;
}

const styles = StyleSheet.create({
  block: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  group: { gap: space.xs },
  center: { textAlign: "center" },
  photos: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.xs },
  photo: { width: 88, height: 88, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.well },
  photoFallback: { alignItems: "center", justifyContent: "center", gap: space.xs, padding: space.xs },
});
