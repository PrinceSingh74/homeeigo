import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { ArrowRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

function MascotOrbit() {
  const spin = useSharedValue(0);
  const float = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: 7000, easing: Easing.linear }),
      -1,
      false
    );
    float.value = withRepeat(
      withTiming(-6, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));
  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value }],
  }));

  return (
    <View style={styles.mascotWrap} pointerEvents="none">
      <Animated.View style={[styles.mascotRing, ringStyle]} />
      <Animated.Text style={[styles.mascotEmoji, floatStyle]}>🤖</Animated.Text>
    </View>
  );
}

export const FinalCtaSection: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={
          isDark
            ? ["#1E1B4B", "#312E81"]
            : ["#EDE9FE", "#F5F3FF", "#FCE7F3"]
        }
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, shadowStyles.md]}
      >
        <View style={styles.content}>
          <Text
            style={[styles.heading, { color: themeColors.text }]}
            numberOfLines={2}
          >
            Ready to experience the future?
          </Text>
          <Text
            style={[styles.sub, { color: themeColors.textSecondary }]}
            numberOfLines={2}
          >
            Book premium AI-powered home services instantly.
          </Text>

          <Pressable>
            <LinearGradient
              colors={["#2563EB", "#7C3AED"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.btn, shadowStyles.glowBlue]}
            >
              <Text style={styles.btnText}>Get Started</Text>
              <ArrowRight size={15} color="#fff" strokeWidth={2.6} />
            </LinearGradient>
          </Pressable>
        </View>

        <MascotOrbit />
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 24,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 24,
    paddingVertical: 22,
    paddingLeft: 20,
    paddingRight: 12,
    overflow: "hidden",
  },
  content: {
    flex: 1,
    paddingRight: 8,
  },
  heading: {
    fontSize: 19,
    fontWeight: "800",
    letterSpacing: -0.4,
    lineHeight: 25,
  },
  sub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 17,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    alignSelf: "flex-start",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
  },
  btnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.2,
  },
  mascotWrap: {
    width: 84,
    height: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  mascotRing: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: "rgba(124,58,237,0.35)",
    borderStyle: "dashed",
  },
  mascotEmoji: {
    fontSize: 48,
  },
});
