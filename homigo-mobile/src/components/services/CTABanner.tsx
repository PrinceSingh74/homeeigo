import React, { useEffect } from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  FadeInUp,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { PressableScale } from "@/components/ai/PressableScale";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useServicesTheme } from "./ServicesThemeContext";

export function CTABanner() {
  const { bookFirstOffer } = useServicesActions();
  const { c, isDark, layout: L } = useServicesTheme();
  const shimmer = useSharedValue(-1);

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 2400 }), -1, false);
  }, [shimmer]);

  const shimmerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shimmer.value * 280 }],
    opacity: 0.2,
  }));

  const gradientColors = isDark
    ? ([c.darkBg, c.expressMid, c.primary2] as const)
    : (["#5B21B6", "#6D28D9", "#7C3AED"] as const);

  return (
    <Animated.View entering={FadeInUp.duration(520)}>
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[
          styles.container,
          {
            paddingHorizontal: L.pad + 4,
            paddingTop: L.isCompact ? 22 : 28,
            paddingBottom: L.isCompact ? 28 : 36,
          },
        ]}
      >
        <View style={styles.decorCircle} />
        <View style={styles.decorCircleSm} />
        <Text style={styles.overline}>First booking offer</Text>
        <Text style={styles.title}>
          Ready to experience the future of home services?
        </Text>
        <Text style={styles.subtitle}>
          Book now and get ₹150 OFF on your first service
        </Text>
        <PressableScale
          style={styles.btn}
          scaleTo={0.96}
          onPress={() => {
            Haptics.notificationAsync(
              Haptics.NotificationFeedbackType.Success,
            ).catch(() => {});
            bookFirstOffer();
          }}
        >
          <Animated.View style={[styles.shimmer, shimmerStyle]} />
          <Text style={[styles.btnText, { color: c.primary }]}>
            Book a Service Now
          </Text>
          <ArrowRight size={17} color={c.primary} strokeWidth={2.5} />
        </PressableScale>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
  },
  decorCircle: {
    position: "absolute",
    top: -70,
    right: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: "#fff",
    opacity: 0.07,
  },
  decorCircleSm: {
    position: "absolute",
    bottom: -40,
    left: -30,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#fff",
    opacity: 0.05,
  },
  overline: {
    ...serviceType.overline,
    color: "rgba(255,255,255,0.65)",
    marginBottom: 8,
  },
  title: {
    ...serviceType.sectionTitle,
    fontSize: 19,
    lineHeight: 26,
    color: "#fff",
    maxWidth: "95%",
  },
  subtitle: {
    ...serviceType.sectionSubtitle,
    color: "rgba(255,255,255,0.78)",
    marginTop: 8,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: layout.cardRadiusSm,
    paddingVertical: 15,
    paddingHorizontal: 22,
    marginTop: 20,
    overflow: "hidden",
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 72,
    backgroundColor: "#fff",
  },
  btnText: {
    ...serviceType.button,
  },
});
