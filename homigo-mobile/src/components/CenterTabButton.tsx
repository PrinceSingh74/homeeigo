import React, { useEffect } from "react";
import {
  View,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
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
import { shadowStyles } from "@/lib/colors";

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

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulse]);

  const pulseAnimStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + Math.abs(Math.cos(pulse.value * Math.PI * 2)) * 0.3,
    transform: [{ scale: 1 + pulse.value * 0.45 }],
  }));

  return (
    <View style={styles.centerWrap}>
      <Pressable onPress={onPress} style={styles.pressable}>
        <Animated.View style={[styles.pulseRing, pulseAnimStyle]} />
        <LinearGradient
          colors={["#2563EB", "#7C3AED"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.centerBtn, shadowStyles.glowBlue]}
        >
          <Sparkles size={24} color="#fff" />
        </LinearGradient>
      </Pressable>
      <Text
        style={[
          styles.centerLabel,
          { color: focused ? themeColors.primary : themeColors.textSecondary },
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
    justifyContent: "flex-end",
    gap: 4,
  },
  pressable: {
    alignItems: "center",
    justifyContent: "center",
  },
  centerBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -24,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 10,
  },
  pulseRing: {
    position: "absolute",
    top: -24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#7C3AED",
  },
  centerLabel: {
    fontSize: 10,
    fontWeight: "700",
  },
});
