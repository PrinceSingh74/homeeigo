import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorBlock, HqCard, HqMuted, LoadingBlock } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { formatDate } from "@/lib/format";
import { READINESS_ROUTES, describeServiceRequestError, readinessSummary, readinessView, type ReadinessLine } from "@/lib/service-readiness";
import { PartnerApiError, partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";
import type { PartnerServiceSkillCard } from "@/types/partner";

/**
 * "My services" — the services this professional performs, has asked for, or has had paused
 * (`GET /api/providers/me/service-skills`), and for each one they perform, whether they are actually
 * being offered its jobs. Being authorised for a service is not the same as being matched for it: a
 * service can require verified identity, a cleared background check, experience, training or
 * credentials, and a professional who misses one is never offered the job. The server reports that as
 * `readiness`; the sentences and next steps come from `lib/service-readiness.ts`. A card without
 * `readiness` (older backend) shows nothing about readiness.
 */

const BOARD_KEY = ["partner", "service-skills"] as const;
/** The catalogue can be long; like partner web, the request list shows the first matches only. */
const AVAILABLE_LIMIT = 40;

const errorText = (e: unknown) => describeServiceRequestError(e instanceof PartnerApiError ? e.code : null, e instanceof Error ? e.message : null);

export function MyServicesScreen() {
  const qc = useQueryClient();
  const enabled = useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
  const board = useQuery({ queryKey: BOARD_KEY, queryFn: () => partnerApi.serviceSkills(), enabled });
  const [search, setSearch] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => void qc.invalidateQueries({ queryKey: BOARD_KEY });
  const request = useMutation({
    mutationFn: (serviceId: string) => partnerApi.requestServiceSkill(serviceId, note.trim() || undefined),
    onMutate: () => { setError(null); setMessage(null); },
    onSuccess: () => { setNote(""); setMessage("Request sent. The Homeeigo team has to approve it before you are offered jobs for this service."); },
    onError: (e) => setError(errorText(e)),
    onSettled: refresh,
  });
  const withdraw = useMutation({
    mutationFn: (capabilityId: number) => partnerApi.withdrawServiceSkill(capabilityId),
    onMutate: () => { setError(null); setMessage(null); },
    onSuccess: () => setMessage("Request withdrawn."),
    onError: (e) => setError(errorText(e)),
    onSettled: refresh,
  });

  const subtitle = "The services you perform, and whether you are being offered their jobs.";

  if (board.isLoading || board.isPending) {
    return (
      <PartnerScreen title="My services" subtitle={subtitle} showBack>
        <LoadingBlock label="Loading your services…" />
      </PartnerScreen>
    );
  }
  if (board.isError || !board.data) {
    return (
      <PartnerScreen title="My services" subtitle={subtitle} showBack>
        <HqCard>
          <ErrorBlock message="Could not load your services." />
          <Btn label="Try again" a11y="Try loading your services again" busy={board.isFetching} onPress={() => void board.refetch()} />
        </HqCard>
      </PartnerScreen>
    );
  }

  const b = board.data;
  const summary = readinessSummary(b.performing);
  const q = search.trim().toLowerCase();
  const matches = b.available.filter((s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));

  return (
    <PartnerScreen title="My services" subtitle={subtitle} showBack>
      <View testID="services-screen">
        {summary ? (
          <View testID="services-readiness-summary">
            <HqCard>
              <Text style={styles.summary} accessibilityRole="alert">⚠ {summary}</Text>
            </HqCard>
          </View>
        ) : null}
        {message ? <Text style={styles.notice} accessibilityRole="alert">✓ {message}</Text> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">⚠ {error}</Text> : null}

        <Lane testID="services-performing" title={`Performing (${b.performing.length})`} empty="No services yet. The services you chose at signup appear here.">
          {b.performing.map((s) => (
            <ServiceRow key={s.serviceId} card={s}>
              <Readiness card={s} />
            </ServiceRow>
          ))}
        </Lane>

        <Lane testID="services-pending" title={`Awaiting approval (${b.pending.length})`} empty="No open requests.">
          {b.pending.map((s) => (
            <ServiceRow key={s.serviceId} card={s} state="○ Being reviewed by the Homeeigo team" stateWords="Being reviewed by the Homeeigo team">
              {s.requestedAt ? <Text style={styles.meta}>Requested on {formatDate(s.requestedAt)}</Text> : null}
              {s.requestNote ? <Text style={styles.meta}>Your note: {s.requestNote}</Text> : null}
              {s.capabilityId != null ? (
                <View style={styles.actions}>
                  <Btn label="Withdraw request" a11y={`Withdraw request for ${s.name}`} busy={withdraw.isPending && withdraw.variables === s.capabilityId} disabled={withdraw.isPending} onPress={() => withdraw.mutate(s.capabilityId!)} />
                </View>
              ) : null}
            </ServiceRow>
          ))}
        </Lane>

        {b.suspended.length ? (
          <Lane testID="services-suspended" title={`Suspended (${b.suspended.length})`} empty="" hint="Paused by the Homeeigo team. You are not offered these jobs until they restore the service.">
            {b.suspended.map((s) => (
              <ServiceRow key={s.serviceId} card={s} state="⏸ Suspended" stateWords="Suspended" />
            ))}
          </Lane>
        ) : null}

        {b.revoked.length ? (
          <Lane testID="services-revoked" title={`Revoked (${b.revoked.length})`} empty="" hint="Removed by the Homeeigo team. Contact support if you think this is wrong.">
            {b.revoked.map((s) => (
              <ServiceRow key={s.serviceId} card={s} state="⊘ Revoked" stateWords="Revoked" />
            ))}
            <View style={styles.actions}>
              <Btn label="Contact support" a11y="Contact support" link onPress={() => router.push(READINESS_ROUTES.support)} />
            </View>
          </Lane>
        ) : null}

        <View testID="services-available">
          <HqCard>
            <Text style={styles.laneTitle} accessibilityRole="header">Available to request</Text>
            {!b.approvalWorkflow ? (
              <HqMuted>New service requests are not available yet. The services you chose at signup are unchanged.</HqMuted>
            ) : b.available.length === 0 ? (
              <HqMuted>Every catalogue service is already on your account. A newly published service will appear here.</HqMuted>
            ) : (
              <>
                <HqMuted>Ask for a service you can now do. You are offered its jobs only after the Homeeigo team approves it.</HqMuted>
                <Text style={styles.fieldLabel}>Why you are ready (optional)</Text>
                <TextInput value={note} onChangeText={setNote} maxLength={300} placeholder="e.g. completed spa training this month" placeholderTextColor={partnerColors.textMuted} accessibilityLabel="Why you are ready for this service" style={styles.input} />
                <Text style={styles.fieldLabel}>Search services</Text>
                <TextInput value={search} onChangeText={setSearch} placeholder="e.g. spa" placeholderTextColor={partnerColors.textMuted} accessibilityLabel="Search services" autoCapitalize="none" autoCorrect={false} style={styles.input} />
                {matches.length === 0 ? <EmptyState message="No services match that search." /> : null}
                {matches.slice(0, AVAILABLE_LIMIT).map((s) => (
                  <ServiceRow key={s.serviceId} card={s}>
                    <View style={styles.actions}>
                      <Btn primary label="Request approval" a11y={`Request approval for ${s.name}`} busy={request.isPending && request.variables === s.serviceId} disabled={request.isPending} onPress={() => request.mutate(s.serviceId)} />
                    </View>
                  </ServiceRow>
                ))}
                {matches.length > AVAILABLE_LIMIT ? <HqMuted>{`Showing ${AVAILABLE_LIMIT} of ${matches.length}. Search to narrow the list.`}</HqMuted> : null}
              </>
            )}
          </HqCard>
        </View>
      </View>
    </PartnerScreen>
  );
}

/** Readiness of one PERFORMING service; renders nothing when the server sent none. */
function Readiness({ card }: { card: PartnerServiceSkillCard }) {
  const view = readinessView(card.readiness);
  if (!view) return null;
  if (view.ready) {
    return (
      <Text testID={`service-ready-${card.serviceId}`} style={styles.ready} accessibilityLabel={`${card.name}: ${view.label}`}>
        {view.glyph} {view.label}
      </Text>
    );
  }
  return (
    <View testID={`service-not-ready-${card.serviceId}`}>
      <Text style={styles.notReady} accessibilityLabel={`${card.name}: ${view.label}. ${view.lines.length} thing${view.lines.length === 1 ? "" : "s"} to resolve.`}>
        {view.glyph} {view.label}
      </Text>
      {view.lines.map((l, i) => (
        <GapLine key={`${i}-${l.text}`} line={l} />
      ))}
    </View>
  );
}

function GapLine({ line }: { line: ReadinessLine }) {
  return (
    <View style={styles.gap}>
      <Text style={styles.gapText}>• {line.text}</Text>
      {line.target && line.actionLabel ? (
        <View style={styles.actions}>
          <Btn label={line.actionLabel} a11y={line.actionLabel} link onPress={() => router.push(READINESS_ROUTES[line.target!])} />
        </View>
      ) : null}
    </View>
  );
}

function Lane({ testID, title, empty, hint, children }: { testID: string; title: string; empty: string; hint?: string; children: ReactNode[] | ReactNode }) {
  const isEmpty = Array.isArray(children) ? children.filter(Boolean).length === 0 : !children;
  return (
    <View testID={testID}>
      <HqCard>
        <Text style={styles.laneTitle} accessibilityRole="header">{title}</Text>
        {hint ? <HqMuted>{hint}</HqMuted> : null}
        {isEmpty ? <Text style={styles.empty}>{empty}</Text> : children}
      </HqCard>
    </View>
  );
}

function ServiceRow({ card, state, stateWords, children }: { card: PartnerServiceSkillCard; state?: string; stateWords?: string; children?: ReactNode }) {
  return (
    <View style={styles.row} testID={`service-${card.lane}-${card.serviceId}`}>
      <View accessible accessibilityLabel={`${card.name}, ${card.category}${stateWords ? `: ${stateWords}` : ""}`}>
        <Text style={styles.rowTitle}>{card.name}</Text>
        <Text style={styles.meta}>{card.category}</Text>
        {state ? <Text style={styles.state}>{state}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Btn({ label, onPress, a11y, disabled, busy, primary, link }: { label: string; onPress: () => void; a11y: string; disabled?: boolean; busy?: boolean; primary?: boolean; link?: boolean }) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole={link ? "link" : "button"}
      accessibilityLabel={a11y}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      disabled={off}
      onPress={onPress}
      style={[styles.btn, primary ? styles.btnPrimary : styles.btnGhost, off && styles.btnDisabled]}
    >
      <Text style={primary ? styles.btnPrimaryText : styles.btnGhostText}>{busy ? "Working…" : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { fontSize: 14, lineHeight: 20, fontWeight: "700", color: partnerColors.text },
  notice: { fontSize: 13, lineHeight: 19, color: partnerColors.text, marginBottom: 12 },
  error: { fontSize: 13, lineHeight: 19, color: partnerColors.danger, marginBottom: 12 },
  laneTitle: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  empty: { fontSize: 13, lineHeight: 19, color: partnerColors.textMuted, paddingVertical: 6 },
  row: { paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line },
  rowTitle: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  meta: { fontSize: 12, lineHeight: 17, color: partnerColors.textSecondary, marginTop: 2 },
  state: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginTop: 4 },
  ready: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginTop: 6 },
  notReady: { fontSize: 13, fontWeight: "700", color: partnerColors.text, marginTop: 6 },
  gap: { marginTop: 6 },
  gapText: { fontSize: 13, lineHeight: 19, color: partnerColors.textSecondary },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: partnerColors.text, marginTop: 10, marginBottom: 4 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text, backgroundColor: partnerColors.surface },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12 },
  btnPrimary: { backgroundColor: partnerColors.primary },
  btnPrimaryText: { color: partnerColors.surface, fontWeight: "700", fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: partnerColors.line },
  btnGhostText: { color: partnerColors.text, fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
});
