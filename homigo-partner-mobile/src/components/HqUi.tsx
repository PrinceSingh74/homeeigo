import type { LucideIcon } from "lucide-react-native";
import { ChevronRight, CloudOff, Inbox } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Button, Pill, Skeleton, T } from "@/components/ui";
import { color, elevation, radius, space, touch } from "@/theme/tokens";

/**
 * The HQ screens' shared pieces, on the design tokens. Names and props are the ones those screens
 * already use; what changed is how they look, that every row is a labelled 48-pt target, that
 * loading has the shape of content, and that an error can be retried.
 */

export function HqCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function HqCardTitle({ children }: { children: string }) {
  return (
    <T kind="heading" accessibilityRole="header" style={styles.cardTitle}>
      {children}
    </T>
  );
}

export function HqMuted({ children }: { children: string }) {
  return <T kind="small">{children}</T>;
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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[label, badgeLabel, subtitle].filter(Boolean).join(". ")}
      style={({ pressed }) => [styles.linkRow, pressed ? styles.pressed : null]}
    >
      <View style={styles.linkIcon}>
        <Icon color={color.leaf} size={18} />
      </View>
      <View style={styles.linkBody}>
        <View style={styles.linkTitleRow}>
          <T kind="bodyStrong" style={styles.linkLabel}>
            {label}
          </T>
          {badgeLabel ? <Pill label={badgeLabel} tone="leaf" /> : null}
        </View>
        {subtitle ? <T kind="small">{subtitle}</T> : null}
      </View>
      <ChevronRight color={color.mist} size={18} />
    </Pressable>
  );
}

export function StatRow({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statRow} accessible accessibilityLabel={`${label}: ${value}`}>
      <T kind="body" tone="slate" style={styles.statLabel}>
        {label}
      </T>
      <T kind="bodyStrong" numeric style={styles.statValue}>
        {value}
      </T>
    </View>
  );
}

export function ProgressRow({ label, pct }: { label: string; pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  return (
    <View style={styles.progressWrap} accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped) }}>
      <View style={styles.progressHeader}>
        <T kind="body" style={styles.statLabel}>
          {label}
        </T>
        <T kind="bodyStrong" tone="leaf" numeric>
          {Math.round(clamped)}%
        </T>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${clamped}%` }]} />
      </View>
    </View>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.state}>
      <View style={styles.stateIcon}>
        <Inbox color={color.leaf} size={22} />
      </View>
      <T kind="small" style={styles.stateText}>
        {message}
      </T>
    </View>
  );
}

/** Loading has the shape of what is coming, and tells a screen reader what is happening. */
export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <Skeleton height={18} width="50%" />
      <Skeleton height={14} />
      <Skeleton height={14} width="80%" />
    </View>
  );
}

/** What went wrong, in the words that were given, and a way to ask again when the screen has one. */
export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.state} accessible accessibilityRole="alert">
      <View style={[styles.stateIcon, styles.stateIconDanger]}>
        <CloudOff color={color.danger} size={22} />
      </View>
      <T kind="small" tone="ink" style={styles.stateText}>
        {message}
      </T>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: color.line, marginBottom: space.md, ...elevation.card },
  cardTitle: { marginBottom: space.md },
  pressed: { backgroundColor: color.well },
  linkRow: { minHeight: touch.min + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  linkIcon: { width: 36, height: 36, borderRadius: radius.control, backgroundColor: color.leafWash, alignItems: "center", justifyContent: "center" },
  linkBody: { flex: 1, gap: 2 },
  linkTitleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  linkLabel: { flexShrink: 1 },
  statRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, paddingVertical: space.sm + 2, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  statLabel: { flex: 1 },
  statValue: { textAlign: "right" },
  progressWrap: { marginBottom: space.md },
  progressHeader: { flexDirection: "row", justifyContent: "space-between", gap: space.md, marginBottom: space.sm },
  progressTrack: { height: 8, borderRadius: radius.pill, backgroundColor: color.well, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: color.leaf, borderRadius: radius.pill },
  state: { paddingVertical: space.xxl, paddingHorizontal: space.lg, alignItems: "center", gap: space.sm },
  stateIcon: { width: 48, height: 48, borderRadius: radius.pill, backgroundColor: color.leafWash, alignItems: "center", justifyContent: "center" },
  stateIconDanger: { backgroundColor: color.dangerWash },
  stateText: { textAlign: "center" },
  retry: { marginTop: space.sm, alignSelf: "stretch" },
  loading: { paddingVertical: space.lg, gap: space.md },
});
