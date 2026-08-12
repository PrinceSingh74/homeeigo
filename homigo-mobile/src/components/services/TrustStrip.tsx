import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import {
  BadgeCheck,
  ShieldCheck,
  ReceiptIndianRupee,
  Lock,
  Clock,
  RefreshCw,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useServicesTheme } from "./ServicesThemeContext";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";

/**
 * Service guarantees shown immediately after the hero, so trust lands inside the
 * first ~10 seconds instead of ten sections down.
 *
 * These are Homeeigo's operating guarantees (policy statements), not metrics — no
 * counts, ratings or availability claims are asserted here. Anything numeric lives
 * in SocialProofStrip, which reads it from the backend.
 */
const GUARANTEES: Array<{ icon: LucideIcon; title: string; sub: string }> = [
  { icon: BadgeCheck, title: "Verified Pros", sub: "ID & skill checked" },
  { icon: ShieldCheck, title: "Background Verified", sub: "Police-verified partners" },
  { icon: Clock, title: "On-Time Arrival", sub: "Punctuality promise" },
  { icon: RefreshCw, title: "Rework Guarantee", sub: "Not happy? We redo it" },
  { icon: ReceiptIndianRupee, title: "Transparent Pricing", sub: "GST in, no surprises" },
  { icon: Lock, title: "Secure Payments", sub: "Encrypted checkout" },
];

export function TrustStrip() {
  const { c, shadows, layout: L } = useServicesTheme();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.list, { paddingLeft: L.pad, paddingRight: L.listPeek }]}
    >
      {GUARANTEES.map((g, i) => (
        <Animated.View
          key={g.title}
          entering={FadeInRight.delay(i * 60).duration(400)}
          style={[styles.card, shadows.soft, { backgroundColor: c.card, borderColor: c.cardBorder }]}
          accessible
          accessibilityLabel={`${g.title}. ${g.sub}`}
        >
          <View style={[styles.iconWrap, { backgroundColor: c.chipBg }]}>
            <g.icon size={17} color={c.primary} strokeWidth={2.3} />
          </View>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
            {g.title}
          </Text>
          <Text style={[styles.sub, { color: c.textMuted }]} numberOfLines={2}>
            {g.sub}
          </Text>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, paddingVertical: 4 },
  card: {
    width: 148,
    gap: 8,
    padding: 16,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...serviceType.cardTitleSm, fontWeight: "800" },
  sub: { ...serviceType.captionSm, lineHeight: 15 },
});
