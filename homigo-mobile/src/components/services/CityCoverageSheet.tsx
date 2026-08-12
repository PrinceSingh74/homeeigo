import React, { useState } from "react";
import { View, Text, StyleSheet, Modal, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { X, MapPin, Users, Clock, Building2, Star, CheckCircle2 } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesTheme } from "./ServicesThemeContext";
import { useCityCoverage } from "@/hooks/use-core-data";
import { useServicesActions } from "@/hooks/useServicesActions";
import { Skeleton } from "./common/Skeleton";
import { BookNowButton } from "./common/BookNowButton";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import type { CoverageStatus } from "@/services/core/api";

const nf = (n: number) => n.toLocaleString("en-IN");

const STATUS_LABEL: Record<CoverageStatus, string> = {
  AVAILABLE: "Live",
  LIMITED: "Limited",
  COMING_SOON: "Coming soon",
};

type Tab = "areas" | "pincodes" | "societies";

/**
 * Hyperlocal coverage explorer — the app equivalent of the website's
 * CityCoverageModal. Reads GET /api/coverage/cities/:slug (the same endpoint the
 * website uses) so areas, pincodes, societies and live availability are identical
 * across web and app. All values are backend-derived; nothing is invented.
 */
export function CityCoverageSheet({
  slug,
  cityName,
  onClose,
}: {
  slug: string | null;
  cityName?: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { c, isDark } = useServicesTheme();
  const { book } = useServicesActions();
  const [tab, setTab] = useState<Tab>("areas");
  const { data, isLoading } = useCityCoverage(slug);

  const s = data?.summary;
  const re = data?.responseEngine;

  const statusTone = (st: CoverageStatus) =>
    st === "AVAILABLE" ? c.success : st === "LIMITED" ? c.gold : c.textMuted;

  return (
    <Modal visible={Boolean(slug)} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: c.background, paddingBottom: insets.bottom + 12 },
          ]}
        >
          {/* Header */}
          <LinearGradient
            colors={isDark ? ["#0f3d31", "#0b1f19"] : ["#065f46", "#0f766e"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}
          >
            <View style={styles.headerRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.headerEyebrow}>Hyperlocal coverage</Text>
                <Text style={styles.headerTitle}>{s?.name ?? cityName ?? "City"}</Text>
                {s ? (
                  <Text style={styles.headerSub}>
                    {s.state} · {STATUS_LABEL[s.status]}
                  </Text>
                ) : null}
              </View>
              <PressableScale
                onPress={onClose}
                haptic
                scaleTo={0.92}
                style={styles.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Close coverage details"
              >
                <X size={18} color="#fff" strokeWidth={2.6} />
              </PressableScale>
            </View>

            {s ? (
              <View style={styles.kpiRow}>
                <Kpi icon={Users} value={nf(s.activePartners)} label="partners" />
                <Kpi icon={MapPin} value={`${s.areaCount}`} label="areas" />
                <Kpi icon={Building2} value={nf(s.societyCount)} label="societies" />
                {re ? <Kpi icon={Clock} value={`${re.avgArrivalMins}m`} label="avg arrival" /> : null}
              </View>
            ) : null}
          </LinearGradient>

          {/* Tabs */}
          <View style={[styles.tabs, { borderBottomColor: c.borderLight }]}>
            {(["areas", "pincodes", "societies"] as Tab[]).map((t) => {
              const active = tab === t;
              const count =
                t === "areas" ? data?.areas.length : t === "pincodes" ? data?.pincodes.length : data?.societies.length;
              return (
                <Pressable
                  key={t}
                  onPress={() => setTab(t)}
                  style={[styles.tab, active && { borderBottomColor: c.primary }]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${t}${count != null ? `, ${count}` : ""}`}
                >
                  <Text style={[styles.tabText, { color: active ? c.primary : c.textMuted }]}>
                    {t[0]!.toUpperCase() + t.slice(1)}
                    {count != null ? ` (${count})` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {isLoading ? (
              <View style={{ gap: 10 }}>
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} width="100%" height={64} radius={layout.cardRadius} />
                ))}
              </View>
            ) : !data ? (
              <Text style={[styles.empty, { color: c.textMuted }]}>
                Coverage details unavailable right now.
              </Text>
            ) : (
              <>
                {tab === "areas" &&
                  data.areas.map((a) => (
                    <View key={a.id} style={[styles.row, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
                      <View style={styles.rowMain}>
                        <Text style={[styles.rowTitle, { color: c.textPrimary }]}>{a.name}</Text>
                        <Text style={[styles.rowSub, { color: c.textMuted }]}>
                          {a.pincodes.join(", ")} · {a.societyCount} societies
                        </Text>
                      </View>
                      <View style={styles.rowMeta}>
                        <Text style={[styles.rowStat, { color: statusTone(a.status) }]}>
                          {STATUS_LABEL[a.status]}
                        </Text>
                        <Text style={[styles.rowSub, { color: c.textMuted }]}>
                          {a.activePartners} pros · {a.avgArrivalMins}m
                        </Text>
                      </View>
                    </View>
                  ))}

                {tab === "pincodes" &&
                  data.pincodes.map((p) => (
                    <View
                      key={p.pincode}
                      style={[styles.row, { backgroundColor: c.card, borderColor: c.cardBorder }]}
                    >
                      <View style={styles.rowMain}>
                        <Text style={[styles.rowTitle, { color: c.textPrimary }]}>{p.pincode}</Text>
                        <Text style={[styles.rowSub, { color: c.textMuted }]}>{p.areaName}</Text>
                      </View>
                      <View style={styles.rowMeta}>
                        <Text style={[styles.rowStat, { color: statusTone(p.status) }]}>
                          {STATUS_LABEL[p.status]}
                        </Text>
                        <Text style={[styles.rowSub, { color: c.textMuted }]}>{p.partnerCount} pros</Text>
                      </View>
                    </View>
                  ))}

                {tab === "societies" &&
                  data.societies.map((so) => (
                    <View key={so.id} style={[styles.row, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
                      <View style={styles.rowMain}>
                        <Text style={[styles.rowTitle, { color: c.textPrimary }]} numberOfLines={1}>
                          {so.name}
                        </Text>
                        <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                          {so.areaName} · {so.availableServices.length} services
                        </Text>
                      </View>
                      <View style={styles.rowMeta}>
                        <View style={styles.ratingRow}>
                          <Star size={11} color={c.gold} fill={c.gold} />
                          <Text style={[styles.rowStat, { color: c.textPrimary }]}>{so.rating}</Text>
                        </View>
                        <Text style={[styles.rowSub, { color: c.textMuted }]}>
                          {so.partnerCount} pros · {so.avgResponseMins}m
                        </Text>
                      </View>
                    </View>
                  ))}

                {re ? (
                  <View style={[styles.engine, { borderColor: c.cardBorder }]}>
                    <Text style={[styles.engineTitle, { color: c.textPrimary }]}>
                      <CheckCircle2 size={13} color={c.success} /> Service reliability
                    </Text>
                    <Text style={[styles.rowSub, { color: c.textMuted }]}>
                      {re.acceptanceRate}% accepted · {re.completionRate}% completed ·{" "}
                      {re.cancellationRate}% cancelled
                    </Text>
                  </View>
                ) : null}
              </>
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: c.borderLight }]}>
            <BookNowButton
              label={s ? `Book in ${s.name}` : "Book a service"}
              onPress={() => {
                onClose();
                book();
              }}
              style={styles.footerCta}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Kpi({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Users;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.kpi}>
      <Icon size={13} color="#6ee7b7" strokeWidth={2.4} />
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(4,20,13,0.55)", justifyContent: "flex-end" },
  sheet: {
    maxHeight: "88%",
    borderTopLeftRadius: layout.cardRadiusXl,
    borderTopRightRadius: layout.cardRadiusXl,
    overflow: "hidden",
  },
  header: { padding: 20, paddingBottom: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  headerEyebrow: {
    ...serviceType.overline,
    color: "rgba(255,255,255,0.7)",
  },
  headerTitle: { color: "#fff", fontSize: 24, fontWeight: "900", letterSpacing: -0.5, marginTop: 4 },
  headerSub: { color: "rgba(255,255,255,0.8)", fontSize: 12, fontWeight: "600", marginTop: 2 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  kpiRow: { flexDirection: "row", gap: 8, marginTop: 16 },
  kpi: {
    flex: 1,
    alignItems: "center",
    gap: 2,
    paddingVertical: 10,
    borderRadius: layout.cardRadiusSm,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  kpiValue: { color: "#fff", fontSize: 15, fontWeight: "900" },
  kpiLabel: { color: "rgba(255,255,255,0.72)", fontSize: 9.5, fontWeight: "600" },

  tabs: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "transparent",
  },
  tabText: { ...serviceType.cardTitleSm, fontSize: 12.5 },

  body: { padding: 16, gap: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 14,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
  },
  rowMain: { flex: 1, minWidth: 0 },
  rowMeta: { alignItems: "flex-end" },
  rowTitle: { ...serviceType.cardTitle, fontWeight: "800" },
  rowSub: { ...serviceType.captionSm, marginTop: 2 },
  rowStat: { ...serviceType.badge, fontSize: 11 },
  ratingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  engine: {
    marginTop: 6,
    padding: 14,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  engineTitle: { ...serviceType.cardTitleSm, fontWeight: "800", marginBottom: 4 },
  empty: { ...serviceType.caption, textAlign: "center", paddingVertical: 32 },

  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  footerCta: { width: "100%", height: 48 },
});
