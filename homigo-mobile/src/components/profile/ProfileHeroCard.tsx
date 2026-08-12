import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  BadgeCheck,
  Calendar,
  Camera,
  Crown,
  MapPin,
  Pencil,
  Star,
} from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAuth } from "@/hooks/use-auth";
import { useMySubscription } from "@/hooks/use-subscription";
import { PROFILE_CARD_RADIUS } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";

type Props = {
  onEdit: () => void;
  onAvatar: () => void;
};

export function ProfileHeroCard({ onEdit, onAvatar }: Props) {
  const { colors: c, isDark } = useTheme();
  const { user } = useAuth();
  const { data: mySub } = useMySubscription();
  const activePlan = mySub?.active ?? null;
  const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Homeeigo User";
  const email = user?.email ?? "Sign in to sync profile";
  const avatar = user?.profileImage ?? "https://api.dicebear.com/7.x/avataaars/png?seed=homigo";
  const pct = user ? (user.isEmailVerified && user.isPhoneVerified ? 100 : 72) : 40;

  return (
    <Animated.View
      entering={profileEnter.hero}
      style={[
        styles.card,
        {
          backgroundColor: c.cardBg,
          borderColor: isDark ? c.border : "#E5E7EB",
        },
        shadowStyles.lg,
      ]}
    >
      <View style={styles.identityRow}>
        <PressableScale onPress={onAvatar} haptic style={styles.avatarWrap}>
          <LinearGradient colors={["#2563EB", "#7C3AED"]} style={styles.avatarRing}>
            <Image source={{ uri: avatar }} style={styles.avatar} />
          </LinearGradient>
          <View style={styles.camBadge}>
            <Camera size={12} color="#fff" strokeWidth={2.5} />
          </View>
        </PressableScale>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text
              style={[profileType.heroName, profileTextBase, { color: c.text, flex: 1 }]}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <BadgeCheck size={18} color={c.teal} fill={c.teal} strokeWidth={0} />
          </View>
          <View style={styles.premiumRow}>
            <Crown size={12} color={c.gold} fill={c.gold} />
            <Text style={[profileType.heroBadge, profileTextBase, { color: c.teal }]}>
              {user?.isEmailVerified ? "Verified member" : "Member"}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <MapPin size={12} color={c.textSecondary} style={styles.metaIcon} />
            <Text
              style={[profileType.heroMeta, profileTextBase, { color: c.text, flex: 1 }]}
              numberOfLines={2}
            >
              {email}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Calendar size={12} color={c.textSecondary} style={styles.metaIcon} />
            <Text style={[profileType.heroMeta, profileTextBase, { color: c.textSecondary }]}>
              Member since {user?.createdAt ? new Date(user.createdAt).getFullYear() : "2026"}
            </Text>
          </View>
        </View>

        <PressableScale onPress={onEdit} haptic style={styles.editBtn}>
          <Pencil size={14} color={c.primary} strokeWidth={2.2} />
          <Text style={[profileType.heroEdit, profileTextBase, { color: c.primary }]}>
            Edit
          </Text>
        </PressableScale>
      </View>

      <View style={[styles.statsRow, { borderTopColor: c.border }]}>
        <StatCol label="Profile Completion" value={`${pct}%`} textColor={c.text} muted={c.textSecondary}>
          <View style={[styles.track, { backgroundColor: isDark ? c.border : "#E5E7EB" }]}>
            <LinearGradient
              colors={["#2563EB", "#7C3AED"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={[styles.fill, { width: `${pct}%` }]}
            />
          </View>
        </StatCol>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <StatCol
          label="Referral Code"
          value={user?.referralCode ?? "—"}
          sub={`${user?.referralCount ?? 0} joined`}
          subColor={c.textSecondary}
          textColor={c.text}
          muted={c.textSecondary}
        />
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <StatCol
          label="Membership"
          value={activePlan ? "Premium" : "Free"}
          sub={
            activePlan?.expiresAt
              ? `until ${new Date(activePlan.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
              : "Tap to upgrade"
          }
          subColor={c.textSecondary}
          textColor={c.text}
          muted={c.textSecondary}
          icon={<Star size={11} color={c.gold} fill={c.gold} />}
        />
      </View>
    </Animated.View>
  );
}

function StatCol({
  label,
  value,
  sub,
  subColor,
  textColor,
  muted,
  children,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  textColor: string;
  muted: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <View style={styles.statCol}>
      <Text
        style={[profileType.statOverline, profileTextBase, { color: muted }]}
        numberOfLines={3}
      >
        {label}
      </Text>
      <View style={styles.valueRow}>
        {icon}
        <Text style={[profileType.statValue, profileTextBase, { color: textColor }]}>
          {value}
        </Text>
      </View>
      {sub ? (
        <Text style={[profileType.statCaption, profileTextBase, { color: subColor }]}>{sub}</Text>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: PROFILE_CARD_RADIUS,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  identityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  avatarWrap: { position: "relative", flexShrink: 0 },
  avatarRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    padding: 3,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: "#E5E7EB" },
  camBadge: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
  },
  info: { flex: 1, minWidth: 0, gap: 6, paddingTop: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  premiumRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  metaRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  metaIcon: { marginTop: 2 },
  editBtn: {
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#2563EB",
    backgroundColor: "rgba(37, 99, 235, 0.05)",
    minWidth: 52,
  },
  statsRow: {
    flexDirection: "row",
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
  },
  statCol: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 6,
    minHeight: 88,
  },
  valueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    marginTop: 8,
  },
  track: {
    width: "100%",
    maxWidth: 100,
    height: 5,
    borderRadius: 3,
    marginTop: 8,
    overflow: "hidden",
    alignSelf: "center",
  },
  fill: { height: "100%", borderRadius: 3 },
  divider: { width: StyleSheet.hairlineWidth * 2, alignSelf: "stretch", marginVertical: 6 },
});
