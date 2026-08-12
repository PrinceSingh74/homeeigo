import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

const ROBOT_IMG = require("../../assets/robot-3d.png");
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { openBook } from "@/lib/navigation";
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
      <Animated.Image
        source={ROBOT_IMG}
        resizeMode="contain"
        style={[styles.mascotImg, floatStyle]}
      />
    </View>
  );
}

export const FinalCtaSection: React.FC = () => {
  const router = useRouter();
  const { colors: themeColors, isDark } = useTheme();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={
          isDark
            ? ["#04140d", "#065f46"]
            : ["#ECFDF5", "#F0FDFA", "#F0FDF4"]
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

          <Pressable onPress={() => openBook(router)}>
            <LinearGradient
              colors={["#10b981", "#0d9488"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.btn, shadowStyles.glowPrimary]}
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
    marginBottom: 14,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 26,
    paddingVertical: 24,
    paddingLeft: 20,
    paddingRight: 10,
    overflow: "hidden",
  },
  content: {
    flex: 1,
    paddingRight: 6,
  },
  heading: {
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.3,
    lineHeight: 23,
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
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
  },
  mascotRing: {
    position: "absolute",
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: "rgba(124,58,237,0.35)",
    borderStyle: "dashed",
  },
  mascotImg: {
    width: 64,
    height: 64,
  },
});
