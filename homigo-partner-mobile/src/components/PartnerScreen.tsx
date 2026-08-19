import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { partnerColors } from "@/theme/colors";

type PartnerScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
};

export function PartnerScreen({ title, subtitle, children, footer, showBack, onBack }: PartnerScreenProps) {
  return (
    <LinearGradient colors={[partnerColors.cream, partnerColors.sage]} style={styles.root}>
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {showBack ? (
            <Pressable onPress={() => (onBack ? onBack() : router.back())} style={styles.backBtn}>
              <ChevronLeft color={partnerColors.primary} size={22} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          ) : null}
          <View style={styles.header}>
            <Text style={styles.brand}>HOMEEIGO Partner</Text>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
          </View>
          {children}
        </ScrollView>
        {footer}
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 20, paddingBottom: 100 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  backText: { fontSize: 14, fontWeight: "600", color: partnerColors.primary },
  header: { marginBottom: 20 },
  brand: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: partnerColors.primary,
    marginBottom: 6,
  },
  title: { fontSize: 28, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.5 },
  subtitle: { marginTop: 6, fontSize: 14, lineHeight: 20, color: partnerColors.textMuted },
});
