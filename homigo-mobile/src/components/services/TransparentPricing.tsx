import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Receipt, ShieldCheck, BadgeIndianRupee, Lock, FileText, UserCheck } from "lucide-react-native";
import { SectionHeader } from "./common/SectionHeader";
import { useServicesTheme } from "./ServicesThemeContext";
import { useCatalogServices } from "@/hooks/use-catalog";
import { useServicesActions } from "@/hooks/useServicesActions";
import { PressableScale } from "@/components/ai/PressableScale";

/** Same services shown on the website's Transparent Pricing section. */
const PRICING = [
  "Bathroom Cleaning",
  "Kitchen Cleaning",
  "Laundry",
  "Sofa Cleaning",
  "Wardrobe Cleaning",
  "Balcony Cleaning",
];

/** Same trust strip as the website (PRICING_TRUST_STRIP). */
const TRUST = [
  { icon: Receipt, label: "GST Included" },
  { icon: ShieldCheck, label: "No Hidden Charges" },
  { icon: BadgeIndianRupee, label: "Upfront Pricing" },
  { icon: Lock, label: "Secure Payments" },
  { icon: FileText, label: "Instant Invoice" },
  { icon: UserCheck, label: "Verified Professionals" },
];

/** Transparent Pricing — 1:1 content with the website services page. */
export function TransparentPricing() {
  const { c } = useServicesTheme();
  const { book } = useServicesActions();
  const { services: catalog } = useCatalogServices();

  const find = (name: string) =>
    catalog.find((s) => s.name.toLowerCase().includes(name.toLowerCase().split(" ")[0]!));

  return (
    <View>
      <SectionHeader
        overline="Upfront Pricing"
        title="Transparent Pricing"
        subtitle="Know exactly what you pay before booking · No surprises"
      />

      {/* pricing cards */}
      <View style={styles.grid}>
        {PRICING.map((name, i) => {
          const svc = find(name);
          return (
            <Animated.View key={name} entering={FadeInUp.delay(i * 60).duration(440)} style={{ width: "47%", flexGrow: 1 }}>
              <PressableScale
                haptic
                onPress={() => svc && book({ service: svc.id })}
                style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}
              >
                <Text style={[styles.cardName, { color: c.textPrimary }]} numberOfLines={1}>{name}</Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.from, { color: c.textMuted }]}>From</Text>
                  <Text style={styles.price}>{svc?.price ?? "₹—"}</Text>
                </View>
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>

      {/* trust strip */}
      <View style={styles.strip}>
        {TRUST.map((t) => (
          <View key={t.label} style={[styles.chip, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <t.icon size={13} color="#059669" strokeWidth={2.2} />
            <Text style={[styles.chipText, { color: c.textSecondary }]}>{t.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 12, marginTop: 4 },
  card: { borderRadius: 16, borderWidth: 1, paddingVertical: 14, paddingHorizontal: 14 },
  cardName: { fontSize: 13.5, fontWeight: "800", letterSpacing: -0.2 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 5, marginTop: 6 },
  from: { fontSize: 10.5, fontWeight: "600" },
  price: { fontSize: 17, fontWeight: "900", color: "#059669", letterSpacing: -0.4 },
  strip: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", paddingHorizontal: 20, gap: 8, marginTop: 16 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 10.5, fontWeight: "700" },
});
