import { router } from "expo-router";
import { LogOut, ShieldCheck, User } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HqCard, HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { PARTNER_HQ_NAV } from "@/lib/partner-navigation";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";

export default function ProfileTab() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || "Partner";
  const accountSection = PARTNER_HQ_NAV.find((s) => s.id === "account");

  async function onLogout() {
    await logout();
    router.replace("/login");
  }

  return (
    <PartnerScreen title="Profile" subtitle="Account, trust status, and session control.">
      <View style={styles.hero}>
        <View style={styles.avatar}>
          <User color={partnerColors.primary} size={28} />
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.badge}>
          <ShieldCheck color={partnerColors.primary} size={14} />
          <Text style={styles.badgeText}>Partner · {user?.role ?? "VENDOR"}</Text>
        </View>
      </View>

      <HqCard>
        {accountSection?.items.map((item) => (
          <HqLinkRow
            key={item.id}
            label={item.label}
            subtitle={item.subtitle}
            icon={item.icon}
            onPress={() => router.push(`/hq/${item.id}`)}
          />
        ))}
      </HqCard>

      <Pressable onPress={() => void onLogout()} style={styles.logout}>
        <LogOut color={partnerColors.danger} size={18} />
        <Text style={styles.logoutText}>Sign out</Text>
      </Pressable>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: partnerColors.line,
    marginBottom: 12,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: partnerColors.sage,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  name: { fontSize: 20, fontWeight: "800", color: partnerColors.text },
  email: { marginTop: 4, fontSize: 13, color: partnerColors.textMuted },
  badge: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: partnerColors.sage,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontWeight: "600", color: partnerColors.primary },
  logout: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.25)",
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.88)",
  },
  logoutText: { color: partnerColors.danger, fontWeight: "700", fontSize: 15 },
});
