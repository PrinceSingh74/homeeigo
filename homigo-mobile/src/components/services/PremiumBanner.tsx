import React, { useEffect } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, {
  ZoomIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Crown, ArrowRight } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { PREMIUM_FEATURES } from "@/constants/servicesData";
import { useServicesTheme } from "./ServicesThemeContext";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useAppStore } from "@/lib/store";

export function PremiumBanner() {
  const { openPremium } = useServicesActions();
  const isPremium = useAppStore((s) => s.isPremium);
  const { c, shadows, layout: L } = useServicesTheme();
  const crownRot = useSharedValue(0);
  const btnGlow = useSharedValue(0.88);

  useEffect(() => {
    crownRot.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
        withTiming(4, { duration: 1400, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    btnGlow.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1600 }),
        withTiming(0.85, { duration: 1600 }),
      ),
      -1,
      true,
    );
  }, [crownRot, btnGlow]);

  const crownStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${crownRot.value}deg` }],
  }));

  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnGlow.value,
  }));

  return (
    <Animated.View
      entering={ZoomIn.duration(480).springify()}
      style={[styles.wrap, { paddingHorizontal: L.pad }]}
    >
      <LinearGradient
        colors={[c.primary, "#8B3DFF", "#9C4AFF"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.container, shadows.deep]}
      >
        <View style={styles.glow} />
        <View style={styles.topRow}>
          <Animated.View style={crownStyle}>
            <Crown size={34} color={c.gold} fill={c.gold} />
          </Animated.View>
          <View style={styles.titleRow}>
            <Text style={styles.title}>HOMIGO Premium</Text>
            <View style={[styles.valueBadge, { backgroundColor: c.gold }]}>
              <Text style={[styles.valueText, { color: c.textPrimary }]}>
                BEST VALUE
              </Text>
            </View>
          </View>
        </View>
        <Text style={styles.desc}>
          Priority booking, elite experts, free revisits, and AI-optimized
          scheduling for your home.
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.features}
        >
          {PREMIUM_FEATURES.map((f) => (
            <View key={f.label} style={styles.feature}>
              <View style={styles.featureIconWrap}>
                <Text style={styles.featureIcon}>{f.icon}</Text>
              </View>
              <Text style={styles.featureLabel}>{f.label}</Text>
            </View>
          ))}
        </ScrollView>
        <Animated.View style={btnStyle}>
          <PressableScale
            style={styles.upgradeBtn}
            haptic
            onPress={() => {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              ).catch(() => {});
              openPremium();
            }}
          >
            <Text style={[styles.upgradeText, { color: c.primary }]}>
              {isPremium ? "Manage Premium" : "Upgrade Now"}
            </Text>
            <ArrowRight size={17} color={c.primary} strokeWidth={2.5} />
          </PressableScale>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  container: {
    borderRadius: layout.cardRadiusLg,
    padding: 22,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    top: -50,
    right: -50,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: "#fff",
    opacity: 0.1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    flex: 1,
    gap: 10,
  },
  title: {
    ...serviceType.sectionTitle,
    color: "#fff",
    fontSize: 19,
  },
  valueBadge: {
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  valueText: {
    ...serviceType.badge,
    fontSize: 9,
  },
  desc: {
    ...serviceType.sectionSubtitle,
    color: "rgba(255,255,255,0.82)",
    marginTop: 10,
    lineHeight: 20,
  },
  features: {
    gap: 14,
    marginTop: 18,
    paddingRight: 8,
  },
  feature: { alignItems: "center", width: 68 },
  featureIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  featureIcon: { fontSize: 18 },
  featureLabel: {
    ...serviceType.captionSm,
    color: "rgba(255,255,255,0.88)",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 13,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    borderRadius: layout.cardRadiusSm,
    paddingVertical: 15,
    marginTop: 20,
  },
  upgradeText: {
    ...serviceType.button,
  },
});
