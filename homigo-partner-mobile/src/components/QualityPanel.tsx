import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { useAuthStore } from "@/stores/auth-store";
import { HqCard } from "@/components/HqUi";
import { warrantyLine } from "@/lib/warranty";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

/**
 * Phase 10 §10/§11 — quality for this job (compact mirror of partner-web QualityPanel): the
 * server's recorded verdict with reason codes as human labels (after a refused complete, this IS
 * the refusal), the customer-confirmation state, and the customer's reported issues (read-only:
 * description + outcome only — the server sends no money or admin detail, and none is invented).
 */

const VERDICT_LABEL: Record<string, string> = {
  PASS: "Passed quality checks",
  PASS_WITH_EXCEPTION: "Passed — an optional step was skipped with a reason",
  REWORK_REQUIRED: "Rework required before this job can be completed",
  ESCALATED: "Under review — completion is blocked",
  FAILED: "Did not meet the standard",
};
const BLOCKING = new Set(["REWORK_REQUIRED", "ESCALATED", "FAILED"]);

const REASON_LABEL: Record<string, string> = {
  SAFETY_HOLD_ACTIVE: "A safety hold is active — only the safety team can clear it",
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
  REJECTED: "Closed — not upheld",
  ESCALATED: "With the senior team",
};

const CASE_ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "Resolved by the support team",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "Closed — no action",
  NONE: "Closed — no further action",
};

const dt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export function QualityPanel({ bookingId }: { bookingId: string }) {
  const quality = useQuery({ queryKey: ["partner", "quality", bookingId], queryFn: () => partnerApi.getQuality(bookingId), staleTime: 10_000 });
  const completion = useQuery({ queryKey: ["partner", "completion", bookingId], queryFn: () => partnerApi.getCompletion(bookingId), staleTime: 10_000 });
  const cases = useQuery({ queryKey: ["partner", "cases", bookingId], queryFn: () => partnerApi.getCases(bookingId), staleTime: 10_000 });

  const latest = quality.data?.latest ?? null;
  const history = quality.data?.history ?? [];
  const missing = history.length ? history[history.length - 1]!.missingChecklistItems : [];
  const comp = completion.data?.completion ?? null;
  const warranty = warrantyLine(completion.data?.warranty, new Date(), dt);
  const caseList = cases.data?.available ? cases.data.cases : [];
  if (!latest && !comp && caseList.length === 0) return null;
  const blocking = !!latest && BLOCKING.has(latest.verdict);

  return (
    <View testID="quality-panel">
      <HqCard>
        <Text style={styles.title} accessibilityRole="header">Quality result</Text>
        {latest ? (
          <View testID="quality-verdict">
            <Text style={blocking ? styles.blockingHead : styles.head} accessibilityRole={blocking ? "alert" : undefined}>
              {blocking ? "⚠ " : ""}
              {VERDICT_LABEL[latest.verdict] ?? latest.verdict} · {dt(latest.at)}
            </Text>
            {latest.reasonCodes.map((c) => (
              <Text key={c} style={blocking ? styles.blockingMeta : styles.meta}>
                • {REASON_LABEL[c] ?? c}
              </Text>
            ))}
            {blocking && missing.length ? <Text style={styles.blockingMeta}>Checklist still open: {missing.join(", ")}</Text> : null}
          </View>
        ) : null}

        {comp ? (
          <Text style={styles.meta} testID="quality-completion">
            {comp.state === "PENDING_CUSTOMER"
              ? `Waiting for the customer to confirm — auto-confirms by ${dt(comp.confirmBy)}.`
              : comp.state === "CONFIRMED"
                ? `The customer confirmed this job${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
                : comp.state === "AUTO_CONFIRMED"
                  ? `This job was confirmed automatically${comp.resolvedAt ? ` on ${dt(comp.resolvedAt)}` : ""}.`
                  : comp.state === "ISSUE_REPORTED"
                    ? "The customer reported an issue — see below."
                    : comp.state}
          </Text>
        ) : null}

        {warranty ? (
          <Text style={styles.meta} testID="quality-warranty">
            {warranty}
          </Text>
        ) : null}

        {caseList.length ? (
          <View style={styles.casesBox} testID="quality-cases">
            <Text style={styles.label}>Reported issues</Text>
            {caseList.map((k) => (
              <View key={k.id} style={styles.caseItem} testID={`quality-case-${k.caseNumber}`}>
                <Text style={styles.head}>
                  {CATEGORY_LABEL[k.category] ?? k.category} · {k.caseNumber} · {CASE_STATE_LABEL[k.state] ?? k.state}
                </Text>
                {k.description ? <Text style={styles.meta}>{k.description}</Text> : null}
                {(k.evidence ?? []).some((e) => e.hasStoredMedia) ? (
                  <View style={styles.photos} testID={`quality-case-photos-${k.caseNumber}`}>
                    {(k.evidence ?? []).filter((e) => e.hasStoredMedia).map((e, i) => (
                      <CasePhoto key={e.id} bookingId={bookingId} caseId={k.id} evidenceId={e.id} label={`Customer photo ${i + 1} for ${k.caseNumber}`} />
                    ))}
                  </View>
                ) : null}
                {k.resolution?.action ?<Text style={styles.meta}>{CASE_ACTION_LABEL[String(k.resolution.action)] ?? "Resolved"}.</Text> : null}
              </View>
            ))}
          </View>
        ) : null}
      </HqCard>
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
      <View style={styles.photoFallback} accessible accessibilityLabel={`${label}: attached, could not be shown`}>
        <Text style={styles.meta}>▣ Photo attached — could not be shown here</Text>
      </View>
    );
  }
  return <Image source={source} onError={() => setFailed(true)} accessibilityRole="image" accessibilityLabel={label} resizeMode="cover" style={styles.photo} />;
}

const styles = StyleSheet.create({
  photos: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  photo: { width: 88, height: 88, borderRadius: 10, borderWidth: 1, borderColor: partnerColors.line, backgroundColor: partnerColors.sage },
  photoFallback: { minHeight: 44, justifyContent: "center", paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: partnerColors.line },
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  head: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginTop: 2 },
  blockingHead: { fontSize: 13, fontWeight: "700", color: "#92400e", marginTop: 2 },
  meta: { fontSize: 12, color: partnerColors.textSecondary, marginTop: 2 },
  blockingMeta: { fontSize: 12, color: "#92400e", marginTop: 2 },
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  casesBox: { gap: 4, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line, paddingTop: 10 },
  caseItem: { marginBottom: 4 },
});
