import React, { useEffect } from "react";
import { View, Pressable, StyleSheet, Text } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Sparkles } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { gradients } from "@/lib/colors";

interface CenterTabButtonProps {
  focused: boolean;
  onPress: () => void;
}

export const CenterTabButton: React.FC<CenterTabButtonProps> = ({
  focused,
  onPress,
}) => {
  const { colors: themeColors } = useTheme();
  const pulse = useSharedValue(0);
  const press = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.35 - pulse.value * 0.3,
    transform: [{ scale: 1 + pulse.value * 0.35 }],
  }));

  const pressStyle = useAnimatedStyle(() => ({
    transform: [{ scale: press.value }],
  }));

  return (
    <View style={styles.centerWrap}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          press.value = withTiming(0.9, { duration: 90 });
        }}
        onPressOut={() => {
          press.value = withTiming(1, { duration: 140 });
        }}
        style={styles.pressable}
      >
        <Animated.View style={[styles.pulseRing, pulseStyle]} />
        <Animated.View style={pressStyle}>
          {/* Brand gradient, not the pre-rebrand blue→purple this used to hardcode.
              The website's AI surface is emerald with no violet anywhere, and this
              button is the most-visible chrome in the app. */}
          <LinearGradient
            colors={[...gradients.aiCard]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.centerBtn}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0.35)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={styles.btnGloss}
            />
            <Sparkles size={25} color="#fff" strokeWidth={2.4} />
          </LinearGradient>
        </Animated.View>
      </Pressable>
      <Text
        style={[
          styles.centerLabel,
          {
            color: focused ? themeColors.primary : themeColors.textSecondary,
            fontWeight: focused ? "800" : "600",
          },
        ]}
      >
        AI Assistant
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  centerWrap: {
    flex: 1,
    alignItems: "center",
    gap: 5,
  },
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -26,
    borderWidth: 4,
    borderColor: "#FFFFFF",
    overflow: "hidden",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 12,
  },
  btnGloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
  },
  pulseRing: {
    position: "absolute",
    top: -26,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#0d9488",
  },
  centerLabel: {
    fontSize: 10,
    letterSpacing: -0.1,
  },
});
