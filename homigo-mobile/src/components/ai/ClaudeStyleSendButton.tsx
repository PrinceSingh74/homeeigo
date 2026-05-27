import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { ArrowUp } from "lucide-react-native";
import { useAiTheme } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

/** Claude.ai send — solid square, terracotta when ready, muted when empty */
const CLAUDE_SEND = "#C96442";
const CLAUDE_SEND_PRESSED = "#B85A3A";

type Props = {
  canSend: boolean;
  onPress: () => void;
};

export function ClaudeStyleSendButton({ canSend, onPress }: Props) {
  const { isDark } = useAiTheme();
  const scale = useSharedValue(canSend ? 1 : 0.94);
  const opacity = useSharedValue(canSend ? 1 : 0.55);

  useEffect(() => {
    scale.value = withSpring(canSend ? 1 : 0.94, { damping: 14, stiffness: 220 });
    opacity.value = withSpring(canSend ? 1 : 0.55, { damping: 14, stiffness: 220 });
  }, [canSend, scale, opacity]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const idleBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.06)";
  const idleIcon = isDark ? "rgba(255,255,255,0.28)" : "rgba(15,23,42,0.28)";

  return (
    <PressableScale
      onPress={onPress}
      disabled={!canSend}
      haptic={canSend}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled: !canSend }}
    >
      <Animated.View
        style={[
          styles.btn,
          animStyle,
          {
            backgroundColor: canSend ? CLAUDE_SEND : idleBg,
          },
          canSend && styles.btnActive,
        ]}
      >
        <ArrowUp
          size={17}
          color={canSend ? "#FFFFFF" : idleIcon}
          strokeWidth={2.5}
        />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnActive: {
    shadowColor: CLAUDE_SEND,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
});

