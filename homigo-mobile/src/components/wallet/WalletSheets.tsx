import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Image,
} from "react-native";
import { X, Bell, Crown, Plus, Smartphone, CreditCard, User } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/lib/store";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { WALLET_PREMIUM_EXPIRY, WALLET_USER } from "@/lib/wallet-mobile-data";
import { WALLET_PAD } from "@/lib/wallet-layout";

type SheetProps = {
  visible: boolean;
  onClose: () => void;
};

export function WalletNotificationsSheet({ visible, onClose }: SheetProps) {
  const { colors: c } = useTheme();
  const items = [
    { title: "₹50 cashback credited", sub: "2 hours ago" },
    { title: "Premium renewal reminder", sub: "Yesterday" },
    { title: "UPI payment successful", sub: "20 May 2025" },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.sheetHead}>
          <View style={styles.sheetTitleRow}>
            <Bell size={20} color={c.primary} />
            <Text style={[styles.sheetTitle, { color: c.text }]}>Notifications</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetList}>
          {items.map((n) => (
            <View
              key={n.title}
              style={[styles.notifRow, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <Text style={[styles.notifTitle, { color: c.text }]}>{n.title}</Text>
              <Text style={[styles.notifSub, { color: c.textSecondary }]}>{n.sub}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

export function WalletAddMoneySheet({ visible, onClose }: SheetProps) {
  const { colors: c } = useTheme();
  const showToast = useAppStore((s) => s.showToast);

  const options = [
    { label: "UPI", icon: Smartphone, color: "#06B6D4" },
    { label: "Debit / Credit Card", icon: CreditCard, color: "#7C3AED" },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.sheetHead}>
          <View style={styles.sheetTitleRow}>
            <Plus size={20} color={c.violet} />
            <Text style={[styles.sheetTitle, { color: c.text }]}>Add Money</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>
        <Text style={[styles.sheetHint, { color: c.textSecondary }]}>
          Choose a payment method. Funds reflect instantly in your HOMIGO wallet.
        </Text>
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <PressableScale
              key={o.label}
              haptic
              onPress={() => {
                showToast(`${o.label} — demo flow`);
                onClose();
              }}
              style={[styles.payRow, { borderColor: c.border, backgroundColor: c.bg }]}
            >
              <View style={[styles.payIcon, { backgroundColor: `${o.color}18` }]}>
                <Icon size={22} color={o.color} />
              </View>
              <Text style={[styles.payLabel, { color: c.text }]}>{o.label}</Text>
            </PressableScale>
          );
        })}
      </View>
    </Modal>
  );
}

export function WalletPremiumSheet({ visible, onClose }: SheetProps) {
  const { colors: c, isDark } = useTheme();
  const showToast = useAppStore((s) => s.showToast);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <LinearGradient
          colors={isDark ? ["#312E81", "#4C1D95"] : ["#EDE9FE", "#F5F3FF"]}
          style={styles.premiumHero}
        >
          <Crown size={36} color="#D4AF37" />
          <Text style={[styles.premiumTitle, { color: c.text }]}>HOMIGO Premium</Text>
          <Text style={[styles.premiumSub, { color: c.textSecondary }]}>
            Active · Valid till {WALLET_PREMIUM_EXPIRY}
          </Text>
        </LinearGradient>
        <Text style={[styles.sheetHint, { color: c.textSecondary, marginTop: spacing.lg }]}>
          Priority support, exclusive offers, free rescheduling & 5% cashback on every service.
        </Text>
        <PressableScale
          haptic
          onPress={() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            showToast("Premium upgrade — demo");
            onClose();
          }}
          style={styles.upgradeWrap}
        >
          <LinearGradient
            colors={["#7C3AED", "#C026D3"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.upgradeBtn}
          >
            <Text style={styles.upgradeText}>Upgrade Now</Text>
          </LinearGradient>
        </PressableScale>
      </View>
    </Modal>
  );
}

type ProfileSheetProps = SheetProps & {
  onOpenProfile: () => void;
};

export function WalletProfileSheet({ visible, onClose, onOpenProfile }: ProfileSheetProps) {
  const { colors: c } = useTheme();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.profileRow}>
          <Image source={{ uri: WALLET_USER.avatar }} style={styles.profileAvatar} />
          <View>
            <Text style={[styles.profileName, { color: c.text }]}>{WALLET_USER.name}</Text>
            <Text style={[styles.profileMeta, { color: c.textSecondary }]}>
              HOMIGO member
            </Text>
          </View>
        </View>
        <PressableScale
          haptic
          onPress={onOpenProfile}
          style={[styles.menuRow, { borderColor: c.border, backgroundColor: c.bg }]}
        >
          <User size={20} color={c.primary} />
          <Text style={[styles.menuLabel, { color: c.text }]}>View full profile</Text>
        </PressableScale>
        <PressableScale
          haptic
          onPress={onClose}
          style={[styles.menuRow, { borderColor: c.border, backgroundColor: c.bg }]}
        >
          <X size={20} color={c.textSecondary} />
          <Text style={[styles.menuLabel, { color: c.text }]}>Close</Text>
        </PressableScale>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  sheet: {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    paddingHorizontal: WALLET_PAD,
    paddingBottom: spacing["3xl"],
    maxHeight: "72%",
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sheetTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  sheetHint: { fontSize: 13, lineHeight: 19, marginBottom: spacing.lg },
  sheetList: { gap: 10, paddingBottom: spacing.xl },
  notifRow: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  notifTitle: { fontSize: 14, fontWeight: "700" },
  notifSub: { fontSize: 11, marginTop: 4 },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 10,
  },
  payIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  payLabel: { fontSize: 15, fontWeight: "700" },
  premiumHero: {
    alignItems: "center",
    padding: spacing.xl,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  premiumTitle: { fontSize: 20, fontWeight: "800", marginTop: 10 },
  premiumSub: { fontSize: 12, marginTop: 4 },
  upgradeWrap: { marginTop: spacing.lg },
  upgradeBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  upgradeText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: spacing.lg,
    marginTop: spacing.sm,
  },
  profileAvatar: { width: 56, height: 56, borderRadius: 14 },
  profileName: { fontSize: 18, fontWeight: "800" },
  profileMeta: { fontSize: 12, marginTop: 2 },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 10,
  },
  menuLabel: { fontSize: 15, fontWeight: "700" },
});
