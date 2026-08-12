import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Sparkles, ArrowRight } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";
import { openBook, openProviders } from "@/lib/navigation";
import { useStatsOverview } from "@/hooks/use-core-data";
import { useAfterInteractive } from "@/hooks/use-after-interactive";

const nf = (n: number) => n.toLocaleString("en-IN");

const { width } = Dimensions.get("window");
const H_PAD = 24;
const STAGE_W = width - H_PAD * 2;
const LEFT_W = STAGE_W * 0.56;
const RIGHT_W = STAGE_W * 0.44;
const IMG = RIGHT_W + 14;

function GradientText({ children }: { children: string }) {
  return (
    <MaskedView
      maskElement={
        <Text style={styles.h1} numberOfLines={1} adjustsFontSizeToFit>
          {children}
        </Text>
      }
    >
      <LinearGradient
        colors={["#10b981", "#0d9488", "#14b8a6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
      >
        <Text
          style={[styles.h1, { opacity: 0 }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {children}
        </Text>
      </LinearGradient>
    </MaskedView>
  );
}

export const HeroSection: React.FC = () => {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();
  const afterInteractive = useAfterInteractive();
  const { data: stats } = useStatsOverview({ enabled: afterInteractive });

  // Entry animations — opacity starts at 1 so a broken Reanimated worklet never leaves a blank hero.
  const fadeAnim = useSharedValue(1);
  const slideAnim = useSharedValue(20);

  // Loop animations
  const floatAnim = useSharedValue(0);
  const glowAnim = useSharedValue(0);

  useEffect(() => {
    slideAnim.value = withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) });

    // Float loop
    floatAnim.value = withRepeat(
      withTiming(-8, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Glow pulse loop
    glowAnim.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [slideAnim, floatAnim, glowAnim]);

  // Animated styles
  const entryAnimStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ translateY: slideAnim.value }],
  }));

  const floatAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatAnim.value }],
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + glowAnim.value * 0.25,
    transform: [{ scale: 0.92 + glowAnim.value * 0.14 }],
  }));

  const emeraldText = isDark ? "#6ee7b7" : "#047857";
  return (
    <View style={styles.container}>
      <Animated.View style={[styles.row, entryAnimStyle]}>
        {/* LEFT — content */}
        <View style={styles.left}>
          <LinearGradient
            colors={["rgba(16,185,129,0.14)", "rgba(13,148,136,0.12)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.badge}
          >
            <Sparkles size={11} color={emeraldText} />
            <Text style={[styles.badgeText, { color: emeraldText }]}>
              AI-Powered{" "}
              <Text style={{ color: themeColors.textSecondary }}>
                Home Assistance
              </Text>
            </Text>
          </LinearGradient>

          <View style={styles.heading}>
            <Text
              style={[styles.h1, { color: themeColors.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              The Future of
            </Text>
            <GradientText>Home Services.</GradientText>
          </View>

          <Text
            style={[styles.sub, { color: themeColors.textSecondary }]}
            numberOfLines={3}
          >
            Smart. Fast. Reliable. Everything your home needs, powered by AI.
          </Text>

          {stats ? (
            <Text style={[styles.statsText, { color: themeColors.textSecondary }]} numberOfLines={1}>
              {stats.averageRating != null
                ? `★ ${stats.averageRating} rating`
                : `${nf(stats.activeProviders)} verified pros`}
              {stats.completedBookings > 0 ? `  ·  ${nf(stats.completedBookings)} jobs done` : ""}
            </Text>
          ) : null}

          <View style={styles.ctas}>
            <Pressable onPress={() => openBook(router)}>
              <LinearGradient
                colors={["#10b981", "#0d9488", "#14b8a6"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.primaryBtn, shadowStyles.glowEmerald]}
              >
                <Text style={styles.primaryText}>Book a Service</Text>
                <ArrowRight size={15} color="#fff" />
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => openProviders(router)}>
              <View style={[styles.ghostBtn, { borderColor: themeColors.border, borderWidth: 1, borderRadius: 999 }]}>
                <Text style={[styles.ghostText, { color: themeColors.text }]}>
                  Find verified pros
                </Text>
              </View>
            </Pressable>
          </View>
        </View>

        {/* RIGHT — floating villa with aurora glow */}
        <View style={styles.right}>
          <Animated.View style={[styles.glowBlob, glowAnimStyle]}>
            <LinearGradient
              colors={["#34d399", "#14b8a6", "#5eead4"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glowFill}
            />
          </Animated.View>

          <Animated.Image
            source={require("../../assets/hero-villa.webp")}
            style={[styles.img, floatAnimStyle]}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: H_PAD,
    paddingTop: 14,
    paddingBottom: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  left: {
    width: LEFT_W,
    paddingRight: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    marginBottom: 12,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  heading: { marginBottom: 12 },
  h1: {
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    marginBottom: 12,
  },
  statsText: {
    fontSize: 11.5,
    fontWeight: "700",
    marginBottom: 16,
  },
  ctas: { gap: 10 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  primaryText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  playCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  ghostText: { fontSize: 12, fontWeight: "700" },
  right: {
    width: RIGHT_W,
    height: IMG + 20,
    alignItems: "center",
    justifyContent: "center",
  },
  glowBlob: {
    position: "absolute",
    width: RIGHT_W * 1.15,
    height: RIGHT_W * 1.15,
  },
  glowFill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    opacity: 0.32,
  },
  img: {
    width: IMG,
    height: IMG,
  },
});
