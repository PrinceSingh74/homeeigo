import React, { useEffect, useState, useCallback } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { ImageIcon, Mic, Sparkles } from "lucide-react-native";
import {
  useAiTheme,
  aiSpacing,
  aiRadius,
  aiType,
  aiCardShadow,
} from "@/lib/ai-mobile-theme";
import { COMPOSER_BAR_HEIGHT } from "@/lib/composer-layout";
import { AiGlassCard } from "./ai-primitives";
import { ClaudeStyleSendButton } from "./ClaudeStyleSendButton";
import { PressableScale } from "./PressableScale";

export { COMPOSER_BAR_HEIGHT } from "@/lib/composer-layout";

type Props = {
  onFocus?: () => void;
  onBlur?: () => void;
  keyboardVisible?: boolean;
  onSend?: (text: string) => boolean;
  sendDisabled?: boolean;
};

export function AiComposerBar({
  onFocus,
  onBlur,
  keyboardVisible,
  onSend,
  sendDisabled,
}: Props) {
  const { c, isDark } = useAiTheme();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.4]) }],
  }));

  const active = focused || keyboardVisible;
  const canSend = text.trim().length > 0 && !sendDisabled;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || sendDisabled) return;
    const ok = onSend?.(trimmed);
    if (ok !== false) setText("");
  }, [text, sendDisabled, onSend]);

  return (
    <View style={styles.wrap}>
      <AiGlassCard shadow="lift" glow radius={aiRadius.xxl} pad={14} style={styles.composerGlass}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Ask anything about your home..."
          placeholderTextColor={c.subtle}
          style={[styles.input, { color: c.text }]}
          cursorColor={c.accent}
          selectionColor={c.accent}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          blurOnSubmit={false}
          multiline={false}
          enablesReturnKeyAutomatically
          editable={!sendDisabled}
          importantForAutofill="no"
          textAlignVertical="center"
        />

        {/* Claude-style action row */}
        <View style={styles.actionRow}>
          <View style={styles.leftActions}>
            <PressableScale hitSlop={8}>
              <View
                style={[
                  styles.toolBtn,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(15,23,42,0.04)" },
                ]}
              >
                <ImageIcon size={17} color={c.subtle} strokeWidth={2.2} />
              </View>
            </PressableScale>
            <View style={styles.aiPill}>
              <Sparkles size={12} color={c.accent} strokeWidth={2.4} />
            </View>
          </View>

          <ClaudeStyleSendButton canSend={canSend} onPress={handleSend} />
        </View>
      </AiGlassCard>

      <PressableScale style={styles.fabWrap} haptic disabled={sendDisabled}>
        <Animated.View style={[styles.fabHalo, haloStyle]} pointerEvents="none" />
        <LinearGradient
          colors={active ? ["#00D1FF", "#7B61FF", "#4A90E2"] : ["#8B5CF6", "#7B61FF", "#4A90E2"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fab}
        >
          <View style={styles.fabInner}>
            <Mic size={22} color="#FFFFFF" strokeWidth={2.6} />
          </View>
        </LinearGradient>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: aiSpacing.screen,
    paddingBottom: 8,
    minHeight: COMPOSER_BAR_HEIGHT,
  },
  composerGlass: { flex: 1 },
  input: {
    ...aiType.body,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 28,
    maxHeight: 28,
    paddingVertical: 0,
    marginBottom: 10,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  leftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  aiPill: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(123,97,255,0.12)",
  },
  fabWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  fabHalo: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#7B61FF",
  },
  fab: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#7B61FF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.55,
    shadowRadius: 16,
    elevation: 12,
  },
  fabInner: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
});
