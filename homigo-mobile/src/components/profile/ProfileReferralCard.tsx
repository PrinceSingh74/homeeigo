import React, { useState } from "react";
import { View, Text, StyleSheet, Share, Modal, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { Gift, Users, Wallet, X, Trophy } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";
import {
  useReferralSummary,
  useReferralHistory,
  useReferralLeaderboard,
  useReferralWithdraw,
} from "@/hooks/use-referrals";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function ProfileReferralCard() {
  const { colors: c } = useTheme();
  const { data: summary } = useReferralSummary();
  const withdraw = useReferralWithdraw();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const code = summary?.code ?? null;
  const balance = summary?.balance ?? 0;

  const share = () => {
    if (!code) return;
    void Share.share({ message: `Join Homeeigo with my referral code ${code} and we both get rewarded! https://homigo.app` });
  };
  const doWithdraw = async () => {
    if (balance <= 0 || busy) return;
    setBusy(true);
    await withdraw(balance);
    setBusy(false);
  };

  return (
    <Animated.View entering={profileEnter.section} style={styles.wrap}>
      <View style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.border }]}>
        <View style={styles.head}>
          <View style={styles.headLeft}>
            <Gift size={18} color={c.primary} />
            <Text style={[styles.title, { color: c.text }]}>Rewards &amp; Referrals</Text>
          </View>
          <Pressable onPress={() => setOpen(true)}>
            <Text style={[styles.link, { color: c.primary }]}>View details</Text>
          </Pressable>
        </View>

        <Text style={[styles.codeLabel, { color: c.textSecondary }]}>Your referral code</Text>
        <Text style={[styles.code, { color: c.text }]}>{code ?? "—"}</Text>
        <View style={styles.metaRow}>
          <Users size={13} color={c.textSecondary} />
          <Text style={[styles.meta, { color: c.textSecondary }]}>
            {summary?.referralCount ?? 0} joined · earn {inr(summary?.commissionPerReferral ?? 100)} each
          </Text>
        </View>

        <View style={[styles.earnBox, { backgroundColor: c.bg, borderColor: c.border }]}>
          <Text style={[styles.earnLabel, { color: c.textSecondary }]}>Referral earnings</Text>
          <Text style={[styles.earnValue, { color: c.text }]}>{inr(balance)}</Text>
          <Text style={[styles.earnSub, { color: c.textSecondary }]}>{inr(summary?.totalEarned ?? 0)} earned all-time</Text>
          {balance > 0 && (
            <PressableScale haptic disabled={busy} onPress={() => void doWithdraw()} style={[styles.wdBtn, { backgroundColor: c.success, opacity: busy ? 0.5 : 1 }]}>
              <Wallet size={13} color="#fff" />
              <Text style={styles.wdBtnText}>{busy ? "Moving…" : `Withdraw ${inr(balance)} to wallet`}</Text>
            </PressableScale>
          )}
        </View>

        <PressableScale haptic disabled={!code} onPress={share} style={[styles.shareBtn, { backgroundColor: c.primary, opacity: code ? 1 : 0.5 }]}>
          <Gift size={15} color="#fff" />
          <Text style={styles.shareBtnText}>Share code</Text>
        </PressableScale>
      </View>

      <ReferralDetailsSheet visible={open} onClose={() => setOpen(false)} />
    </Animated.View>
  );
}

function ReferralDetailsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { data: summary } = useReferralSummary();
  const { data: history, isLoading: hLoading } = useReferralHistory(visible);
  const { data: leaderboard } = useReferralLeaderboard(visible);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>Referrals</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.statStrip}>
          {[
            { l: "Friends", v: String(summary?.referralCount ?? 0) },
            { l: "Qualified", v: String(summary?.qualified ?? 0) },
            { l: "Earned", v: inr(summary?.totalEarned ?? 0) },
          ].map((s) => (
            <View key={s.l} style={[styles.stat, { borderColor: c.border }]}>
              <Text style={[styles.statV, { color: c.text }]}>{s.v}</Text>
              <Text style={[styles.statL, { color: c.textSecondary }]}>{s.l}</Text>
            </View>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
          <Text style={[styles.section, { color: c.textSecondary }]}>REFERRAL HISTORY</Text>
          {hLoading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 16 }} />
          ) : !history || history.length === 0 ? (
            <Text style={[styles.empty, { color: c.textSecondary, borderColor: c.border }]}>No referrals yet. Share your code.</Text>
          ) : (
            history.map((h) => (
              <View key={h.id} style={[styles.row, { borderColor: c.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>{h.refereeName}</Text>
                  <Text style={[styles.rowSub, { color: c.textSecondary }]}>Joined {fmt(h.createdAt)}</Text>
                </View>
                <View style={[styles.badge, { backgroundColor: h.status === "QUALIFIED" ? `${c.success}26` : `${c.warning}26` }]}>
                  <Text style={[styles.badgeText, { color: h.status === "QUALIFIED" ? c.success : c.warning }]}>
                    {h.status === "QUALIFIED" ? `+${inr(h.amount)}` : "Pending"}
                  </Text>
                </View>
              </View>
            ))
          )}

          <View style={styles.lbHead}>
            <Trophy size={13} color={c.gold} />
            <Text style={[styles.section, { color: c.textSecondary, marginBottom: 0 }]}>TOP REFERRERS</Text>
          </View>
          {(leaderboard ?? []).map((l) => (
            <View key={l.rank} style={styles.lbRow}>
              <View style={[styles.lbRank, { backgroundColor: `${c.primary}1A` }]}>
                <Text style={[styles.lbRankText, { color: c.primary }]}>{l.rank}</Text>
              </View>
              <Text style={[styles.lbName, { color: c.text }]} numberOfLines={1}>{l.name}</Text>
              <Text style={[styles.lbMeta, { color: c.textSecondary }]}>{l.referrals} ref</Text>
              <Text style={[styles.lbEarned, { color: c.text }]}>{inr(l.earned)}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 20, marginTop: 16 },
  card: { borderRadius: 16, borderWidth: 1, padding: spacing.lg },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontWeight: "800" },
  link: { fontSize: 12, fontWeight: "700" },
  codeLabel: { fontSize: 11 },
  code: { fontSize: 26, fontWeight: "800", letterSpacing: 1, marginTop: 2 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  meta: { fontSize: 11 },
  earnBox: { borderWidth: 1, borderRadius: 12, padding: spacing.md, marginTop: spacing.md },
  earnLabel: { fontSize: 11 },
  earnValue: { fontSize: 22, fontWeight: "800", marginTop: 2 },
  earnSub: { fontSize: 11 },
  wdBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 10, paddingVertical: 9, marginTop: 10 },
  wdBtnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: spacing.md },
  shareBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  // sheet
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], paddingHorizontal: 20, paddingBottom: spacing["3xl"], maxHeight: "82%" },
  statStrip: { flexDirection: "row", gap: 8, marginBottom: spacing.md },
  stat: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  statV: { fontSize: 16, fontWeight: "800" },
  statL: { fontSize: 10, marginTop: 2 },
  section: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: spacing.md, marginBottom: spacing.sm },
  empty: { fontSize: 12, textAlign: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: 8 },
  rowName: { fontSize: 13, fontWeight: "700" },
  rowSub: { fontSize: 11, marginTop: 2 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: "800" },
  lbHead: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.lg, marginBottom: spacing.sm },
  lbRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  lbRank: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  lbRankText: { fontSize: 11, fontWeight: "800" },
  lbName: { flex: 1, fontSize: 13 },
  lbMeta: { fontSize: 11 },
  lbEarned: { fontSize: 13, fontWeight: "800" },
});
