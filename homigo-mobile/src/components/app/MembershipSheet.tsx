import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { X, Crown, Check } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import {
  useMySubscription,
  useSubscriptionPlans,
  useSubscriptionPurchase,
} from "@/hooks/use-subscription";
import { useMembershipInsights } from "@/hooks/use-entitlements";
import type { MembershipInterval } from "@/services/core/api";

const INTERVAL_LABEL: Record<MembershipInterval, string> = {
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  YEARLY: "/year",
};
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function MembershipSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { data: plans, isLoading: plansLoading } = useSubscriptionPlans();
  const { data: mine, isLoading: mineLoading } = useMySubscription(visible);
  const { data: insights } = useMembershipInsights(visible && !!mine?.active);
  const { purchase, cancel, busy } = useSubscriptionPurchase();

  const active = mine?.active ?? null;
  const entitlements = insights?.entitlements;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Homeeigo Premium</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>

        {mineLoading || plansLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={c.primary} />
          </View>
        ) : active ? (
          <View>
            <LinearGradient colors={[c.primary, "#8B3DFF", "#9C4AFF"]} style={styles.activeHero}>
              <Crown size={30} color={c.gold} fill={c.gold} />
              <Text style={styles.activeName}>{active.plan.name}</Text>
              <Text style={styles.activeSub}>
                {active.cancelledAt ? "Auto-renew off · " : ""}Active until{" "}
                {active.expiresAt ? fmtDate(active.expiresAt) : "—"}
              </Text>
            </LinearGradient>
            <ScrollView style={styles.benefits} contentContainerStyle={{ gap: 10 }}>
              {active.plan.benefits.map((b) => (
                <View key={b.id} style={styles.benefitRow}>
                  <Check size={16} color={c.success} strokeWidth={3} />
                  <Text style={[styles.benefitText, { color: c.textSecondary }]}>{b.label}</Text>
                </View>
              ))}
              {entitlements && (
                <View style={[styles.benefitRow, { marginTop: 8 }]}>
                  <Text style={[styles.benefitText, { color: c.text, fontWeight: "600" }]}>
                    {entitlements.cashbackPct}% cashback · {entitlements.discountPct}% off bookings
                  </Text>
                </View>
              )}
              {(insights?.recentCashback?.length ?? 0) > 0 && (
                <Text style={[styles.benefitText, { color: c.textSecondary, fontSize: 12 }]}>
                  Recent cashback: ₹{insights!.cashbackSummary.totalCredited.toLocaleString("en-IN")}
                </Text>
              )}
            </ScrollView>
            <View style={styles.actions}>
              <PressableScale
                haptic
                disabled={busy}
                onPress={() => void purchase(active.plan.id)}
                style={[styles.primaryBtn, { backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }]}
              >
                {busy && <ActivityIndicator size="small" color="#fff" />}
                <Text style={styles.primaryBtnText}>Renew ({inr(active.plan.price)})</Text>
              </PressableScale>
              {!active.cancelledAt && (
                <PressableScale haptic onPress={() => void cancel()} style={[styles.outlineBtn, { borderColor: c.border }]}>
                  <Text style={[styles.outlineBtnText, { color: c.text }]}>Cancel auto-renew</Text>
                </PressableScale>
              )}
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 12, paddingBottom: spacing.xl }}>
            {(plans ?? []).map((plan) => {
              const best = plan.interval === "YEARLY";
              return (
                <View
                  key={plan.id}
                  style={[styles.planCard, { borderColor: best ? c.primary : c.border, backgroundColor: best ? `${c.primary}0D` : "transparent" }]}
                >
                  <View style={styles.planTop}>
                    <View style={{ flex: 1 }}>
                      <View style={styles.planNameRow}>
                        <Text style={[styles.planName, { color: c.text }]}>{plan.name}</Text>
                        {best && (
                          <View style={[styles.bestTag, { backgroundColor: c.primary }]}>
                            <Text style={styles.bestTagText}>BEST VALUE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={[styles.planPrice, { color: c.text }]}>
                        {inr(plan.price)}
                        <Text style={[styles.planInterval, { color: c.textSecondary }]}>
                          {INTERVAL_LABEL[plan.interval]}
                        </Text>
                      </Text>
                    </View>
                    <PressableScale
                      haptic
                      disabled={busy}
                      onPress={() => void purchase(plan.id)}
                      style={[styles.chooseBtn, { backgroundColor: c.primary, opacity: busy ? 0.5 : 1 }]}
                    >
                      <Text style={styles.chooseBtnText}>{busy ? "…" : "Choose"}</Text>
                    </PressableScale>
                  </View>
                  <View style={{ gap: 6, marginTop: 10 }}>
                    {plan.benefits.map((b) => (
                      <View key={b.id} style={styles.benefitRow}>
                        <Check size={13} color={c.success} strokeWidth={3} />
                        <Text style={[styles.benefitSmall, { color: c.textSecondary }]}>{b.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
            <Text style={[styles.secure, { color: c.textSecondary }]}>Secured by Razorpay · cancel anytime</Text>
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15, 23, 42, 0.45)" },
  sheet: {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    paddingHorizontal: 20,
    paddingBottom: spacing["3xl"],
    maxHeight: "82%",
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  center: { paddingVertical: 40, alignItems: "center" },
  activeHero: { alignItems: "center", padding: spacing.xl, borderRadius: radius.lg, gap: 4 },
  activeName: { color: "#fff", fontSize: 18, fontWeight: "800", marginTop: 6 },
  activeSub: { color: "rgba(255,255,255,0.85)", fontSize: 13 },
  benefits: { marginTop: spacing.lg, maxHeight: 200 },
  benefitRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  benefitText: { fontSize: 14 },
  benefitSmall: { fontSize: 12 },
  actions: { gap: 10, marginTop: spacing.lg },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 14 },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  outlineBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  outlineBtnText: { fontSize: 14, fontWeight: "700" },
  planCard: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  planTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  planNameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  planName: { fontSize: 16, fontWeight: "800" },
  bestTag: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bestTagText: { color: "#fff", fontSize: 8, fontWeight: "800" },
  planPrice: { fontSize: 20, fontWeight: "800", marginTop: 4 },
  planInterval: { fontSize: 12, fontWeight: "500" },
  chooseBtn: { borderRadius: 12, paddingHorizontal: 18, paddingVertical: 10 },
  chooseBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  secure: { fontSize: 11, textAlign: "center", marginTop: 4 },
});
