import { Pressable, StyleSheet, Text, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { ChevronRight } from "lucide-react-native";
import { partnerColors } from "@/theme/colors";

export function HqCard({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function HqCardTitle({ children }: { children: string }) {
  return <Text style={styles.cardTitle}>{children}</Text>;
}

export function HqMuted({ children }: { children: string }) {
  return <Text style={styles.muted}>{children}</Text>;
}

export function HqLinkRow({
  label,
  subtitle,
  icon: Icon,
  badgeLabel,
  onPress,
}: {
  label: string;
  subtitle?: string;
  icon: LucideIcon;
  badgeLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.linkRow}>
      <View style={styles.linkIcon}>
        <Icon color={partnerColors.primary} size={18} />
      </View>
      <View style={styles.linkBody}>
        <View style={styles.linkTitleRow}>
          <Text style={styles.linkLabel}>{label}</Text>
          {badgeLabel ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeLabel}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? <Text style={styles.linkSubtitle}>{subtitle}</Text> : null}
      </View>
      <ChevronRight color={partnerColors.textMuted} size={18} />
    </Pressable>
  );
}

export function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressPct}>{Math.round(clamped)}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${clamped}%` }]} />
      </View>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.muted}>{message}</Text>
    </View>
  );
}

export function LoadingBlock() {
  return (
    <View style={styles.empty}>
      <Text style={styles.muted}>Loading…</Text>
    </View>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.error}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 10 },
  muted: { fontSize: 13, lineHeight: 19, color: partnerColors.textMuted },
  error: { fontSize: 13, color: partnerColors.danger, textAlign: "center" },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: partnerColors.line,
  },
  linkIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: partnerColors.sage,
    alignItems: "center",
    justifyContent: "center",
  },
  linkBody: { flex: 1 },
  linkTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  linkLabel: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  linkSubtitle: { marginTop: 2, fontSize: 12, color: partnerColors.textMuted, lineHeight: 17 },
  badge: { backgroundColor: partnerColors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: partnerColors.line,
  },
  statLabel: { fontSize: 13, color: partnerColors.textMuted, flex: 1, paddingRight: 8 },
  statValue: { fontSize: 13, fontWeight: "700", color: partnerColors.text },
  progressWrap: { marginBottom: 12 },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { fontSize: 13, color: partnerColors.text, flex: 1, paddingRight: 8 },
  progressPct: { fontSize: 13, fontWeight: "700", color: partnerColors.primary },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: partnerColors.sage, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: partnerColors.primary, borderRadius: 999 },
  empty: { paddingVertical: 24, alignItems: "center" },
});
