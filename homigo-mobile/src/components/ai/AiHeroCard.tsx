import React, { useEffect } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
// No microphone iconography here: this build has no speech-to-text, and these
// controls open the text composer. A mic icon would promise dictation the app
// cannot deliver, so the affordance is labelled for what it actually does.
import { LayoutGrid, MessageCircle, Navigation, Sparkles } from "lucide-react-native";
import { useAuth } from "@/hooks/use-auth";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

type Props = {
  /** Opens the composer so the user can ask the AI (real text-first action). */
  onAsk?: () => void;
  /** Navigates to the services catalog. */
  onBrowse?: () => void;
};

const ROBOT = require("../../../assets/robot-3d.png");

/** Hero card is always on a dark gradient — never use light-theme black text */
const HERO_INK = {
  greeting: "#C5D0E8",
  headline: "#FFFFFF",
  subline: "#9AA8C4",
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/**
 * The hero speaks to what the user is actually in the middle of, rather than
 * repeating one generic line. Every branch is driven by real state we already
 * hold — a live booking and the clock — so nothing here is invented.
 */
function heroCopy(hasLiveBooking: boolean, hour: number): { headline: string; subline: string } {
  // The headline column is narrow, so every variant keeps the proven two-short-lines
  // shape; the time/booking context is carried mainly by the subline, which has room.
  if (hasLiveBooking) {
    return {
      headline: "Your pro is\non the way",
      subline: "Track them live, or ask me anything.",
    };
  }
  if (hour < 12) {
    return {
      headline: "How can I help\nthis morning?",
      subline: "Book a service, diagnose an issue, or plan your day.",
    };
  }
  if (hour < 17) {
    return {
      headline: "How can I help\ntoday?",
      subline: "Book services, diagnose issues, or manage your home.",
    };
  }
  return {
    headline: "How can I help\nthis evening?",
    subline: "Book for tomorrow, check an order, or just ask.",
  };
}

export function AiHeroCard({ onAsk, onBrowse }: Props) {
  const { c } = useAiTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { activeBooking } = useActiveTracking();
  const displayName = user?.firstName ?? "there";
  const copy = React.useMemo(
    () => heroCopy(!!activeBooking?.id, new Date().getHours()),
    [activeBooking?.id],
  );

  // Robot float
  const float = useSharedValue(0);
  // Voice orb pulse
  const pulse = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [float, pulse]);

  const robotStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(float.value, [0, 1], [0, -8]) }],
  }));
  const wave1Style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.35]) }],
  }));
  const wave2Style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.35, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.6]) }],
  }));

  return (
    <View style={styles.outer}>
      <LinearGradient
        colors={[...c.heroBg]}
        style={[
          styles.card,
          { borderColor: c.cardBorderStrong },
          aiCardShadow(c.shadowAccent, "hero"),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* Ambient glows */}
        <View style={[styles.glowA, { backgroundColor: c.glowCyan }]} />
        <View style={[styles.glowB, { backgroundColor: c.glowViolet }]} />

        {/* MAIN ROW: robot | text | voice orb */}
        <View style={styles.row}>
          {/* Robot column */}
          <View style={styles.robotCol}>
            <View style={styles.platformShadow} />
            <LinearGradient
              colors={["transparent", "rgba(45, 212, 191, 0.95)", "transparent"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.platformLine}
            />
            <Animated.View style={[styles.robotInner, robotStyle]}>
              <Image source={ROBOT} style={styles.robot} resizeMode="contain" />
            </Animated.View>
          </View>

          {/* Greeting + headline */}
          <View style={styles.textCol}>
            <Text style={[styles.greeting, { color: HERO_INK.greeting }]}>
              {getGreeting()}, {displayName}{" "}
              <Text style={{ fontSize: 13, color: HERO_INK.greeting }}>👋</Text>
            </Text>
            {/* Shrinks rather than truncates: the column is narrow and the copy now
                varies with context, so a fixed size would clip the longer variants
                (and long first names) on 360dp screens. */}
            <Text
              style={[styles.headline, { color: HERO_INK.headline }]}
              numberOfLines={2}
              adjustsFontSizeToFit
              minimumFontScale={0.75}
            >
              {copy.headline}
            </Text>
            <Text
              style={[styles.subline, { color: HERO_INK.subline }]}
              numberOfLines={3}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {copy.subline}
            </Text>
          </View>

          {/* Voice orb with pulsing rings — opens the composer to ask the AI */}
          <PressableScale
            style={styles.orbCol}
            haptic
            onPress={onAsk}
            accessibilityRole="button"
            accessibilityLabel="Ask the AI assistant"
          >
            <Animated.View style={[styles.orbWave, wave2Style]} />
            <Animated.View style={[styles.orbWave, wave1Style]} />
            <View style={styles.orbHalo} />
            <LinearGradient
              colors={["#2dd4bf", "#10b981", "#0d9488"]}
              style={styles.orbBody}
            >
              <View style={styles.orbInner}>
                <Sparkles size={22} color="#FFFFFF" strokeWidth={2.6} />
              </View>
            </LinearGradient>
          </PressableScale>
        </View>

        {/* Context-aware: a live booking gets a track shortcut right in the hero */}
        {activeBooking?.id ? (
          <PressableScale
            haptic
            onPress={() => router.push(`/track/${activeBooking.id}` as never)}
            style={styles.liveRow}
            accessibilityRole="button"
            accessibilityLabel="Track your live booking"
          >
            <View style={styles.liveDot} />
            <Text style={styles.liveText} numberOfLines={1}>
              Your booking is live — track your professional
            </Text>
            <Navigation size={14} color="#6ee7b7" strokeWidth={2.6} />
          </PressableScale>
        ) : null}

        {/* CTA buttons */}
        <View style={styles.ctaRow}>
          <PressableScale
            style={styles.ctaPrimaryWrap}
            haptic
            onPress={onAsk}
            accessibilityRole="button"
            accessibilityLabel="Ask the AI assistant a question"
            accessibilityHint="Opens the message box"
          >
            <LinearGradient
              colors={["#10b981", "#0d9488"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaPrimary}
            >
              <MessageCircle size={16} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.ctaPrimaryText}>Ask AI</Text>
            </LinearGradient>
          </PressableScale>

          <PressableScale
            style={[
              styles.ctaGhost,
              { borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.04)" },
            ]}
            haptic
            onPress={onBrowse}
            accessibilityRole="button"
            accessibilityLabel="Browse services"
          >
            <LayoutGrid size={16} color="#E2E8F0" strokeWidth={2.2} />
            <Text style={styles.ctaGhostText}>Browse Services</Text>
          </PressableScale>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: aiSpacing.screen,
    marginBottom: aiSpacing.section,
  },
  card: {
    borderRadius: aiRadius.xxl,
    borderWidth: 1,
    padding: aiSpacing.cardLg,
    paddingBottom: aiSpacing.card,
    overflow: "hidden",
  },
  glowA: {
    position: "absolute",
    left: -50,
    top: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.6,
  },
  glowB: {
    position: "absolute",
    right: -30,
    bottom: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    opacity: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  robotCol: {
    width: 92,
    height: 110,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  platformShadow: {
    position: "absolute",
    bottom: 4,
    width: 82,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(45, 212, 191, 0.35)",
    shadowColor: "#2dd4bf",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
  },
  platformLine: {
    position: "absolute",
    bottom: 10,
    width: 70,
    height: 4,
    borderRadius: 2,
  },
  robotInner: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  robot: { width: 92, height: 92 },
  textCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
  },
  greeting: { ...aiType.small, fontSize: 12, fontWeight: "600", marginBottom: 2 },
  headline: {
    ...aiType.h1,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 2,
  },
  subline: {
    ...aiType.small,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 6,
    fontWeight: "500",
  },
  orbCol: {
    width: 90,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  orbWave: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: "#10b981",
  },
  orbHalo: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(16, 185, 129,0.35)",
    shadowColor: "#10b981",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
  },
  orbBody: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  orbInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  liveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: aiRadius.md,
    backgroundColor: "rgba(16, 185, 129, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(52, 211, 153, 0.32)",
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#34d399",
  },
  liveText: {
    ...aiType.small,
    flex: 1,
    color: "#D4EFE2",
    fontWeight: "700",
    fontSize: 12,
  },
  ctaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  ctaPrimaryWrap: { flex: 1 },
  ctaPrimary: {
    height: 46,
    borderRadius: aiRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaPrimaryText: {
    ...aiType.bodyStrong,
    fontSize: 13,
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  ctaGhost: {
    flex: 1,
    height: 46,
    borderRadius: aiRadius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaGhostText: {
    ...aiType.bodyStrong,
    fontSize: 13,
    color: "#E2E8F0",
    letterSpacing: -0.2,
  },
});
