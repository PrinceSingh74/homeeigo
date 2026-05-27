import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Image,
  TextInput,
  ScrollView,
  Pressable,
  StyleSheet,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
} from "react-native-reanimated";
import {
  SquarePen,
  Stethoscope,
  UserRound,
  Camera,
  CheckCheck,
  ImageIcon,
  ArrowUp,
} from "lucide-react-native";
import { CHAT_ACTIONS } from "@/lib/ai-mobile-data";
import type { AiChatMessage } from "@/lib/use-ai-chat";
import {
  useAiTheme,
  aiSpacing,
  aiType,
  aiRadius,
  aiCardShadow,
  type AiPalette,
} from "@/lib/ai-mobile-theme";
import { AiGlassCard } from "./ai-primitives";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";

const ROBOT = require("../../../assets/robot-3d.png");
const ACTION_ICONS = [Stethoscope, UserRound, Camera];

type Msg = AiChatMessage;

type Props = {
  messages: Msg[];
  isThinking: boolean;
  onSend: (text: string) => boolean;
  onReset: () => void;
};

/* ───────────── Thinking dots (3 pulsing dots) ───────────── */

function ThinkingDot({ delay, color }: { delay: number; color: string }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
  }, [t, delay]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.3 + t.value * 0.7,
    transform: [{ scale: 0.7 + t.value * 0.45 }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/* ───────────── Bubbles ───────────── */

function UserBubble({ msg, c }: { msg: Msg; c: AiPalette }) {
  return (
    <View style={styles.userWrap}>
      <LinearGradient
        colors={[...c.userBubble]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.userBubble}
      >
        <Text style={styles.userText}>{msg.text}</Text>
      </LinearGradient>
      <View style={styles.userMetaRow}>
        <Text style={[styles.metaTxt, { color: c.subtle }]}>{msg.time}</Text>
        <CheckCheck size={12} color={c.accentBlue} strokeWidth={2.6} />
      </View>
    </View>
  );
}

function AiBubble({ msg, c }: { msg: Msg; c: AiPalette }) {
  return (
    <View style={styles.aiRow}>
      <View
        style={[
          styles.aiAvatarWrap,
          { borderColor: c.cardBorderStrong, backgroundColor: c.cardSoft },
        ]}
      >
        <Image source={ROBOT} style={styles.aiAvatar} />
      </View>
      <View style={styles.aiCol}>
        <View
          style={[
            styles.aiBubble,
            { backgroundColor: c.aiBubble, borderColor: c.cardBorder },
          ]}
        >
          <Text style={[styles.aiText, { color: c.aiBubbleText }]}>{msg.text}</Text>
        </View>
        <Text style={[styles.aiTimeTxt, { color: c.subtle }]}>{msg.time}</Text>
      </View>
    </View>
  );
}

function ThinkingBubble({ c }: { c: AiPalette }) {
  return (
    <View style={styles.aiRow}>
      <View
        style={[
          styles.aiAvatarWrap,
          { borderColor: c.cardBorderStrong, backgroundColor: c.cardSoft },
        ]}
      >
        <Image source={ROBOT} style={styles.aiAvatar} />
      </View>
      <View
        style={[
          styles.aiBubble,
          styles.thinkingBubble,
          { backgroundColor: c.aiBubble, borderColor: c.cardBorder },
        ]}
      >
        <ThinkingDot delay={0} color={c.accent} />
        <ThinkingDot delay={180} color={c.accent} />
        <ThinkingDot delay={360} color={c.accent} />
      </View>
    </View>
  );
}

/* ───────────── Main ───────────── */

export function AiChatBlock({ messages, isThinking, onSend, onReset }: Props) {
  const { c, isDark } = useAiTheme();
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(id);
  }, [messages.length, isThinking]);

  function sendFromInput(text: string) {
    if (onSend(text)) setInput("");
  }

  function handleChipAction(label: string) {
    if (label === "Diagnose Now") sendFromInput("Diagnose my AC issue");
    else if (label === "Book Expert") sendFromInput("Book an expert for me");
  }

  function handleReset() {
    onReset();
    setInput("");
  }

  const canSend = input.trim().length > 0 && !isThinking;

  const newChatBtn = (
    <PressableScale
      onPress={handleReset}
      style={[
        styles.newChat,
        { borderColor: c.cardBorderStrong, backgroundColor: c.card },
        aiCardShadow(c.shadowColor, "soft"),
      ]}
      hitSlop={8}
      haptic
    >
      <SquarePen size={14} color={c.accent} strokeWidth={2.4} />
      <Text style={[styles.newChatLabel, { color: c.accent }]}>New Chat</Text>
    </PressableScale>
  );

  return (
    <View style={styles.wrap}>
      <SectionTitle
        noInset
        title="Chat with HOMIGO AI"
        subtitle="Instant diagnosis & booking"
        right={newChatBtn}
      />

      <AiGlassCard shadow="hero" glow pad={14}>
        {/* Scrollable message area */}
        <ScrollView
          ref={scrollRef}
          style={styles.msgArea}
          contentContainerStyle={styles.msgContent}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          {messages.map((msg) =>
            msg.role === "user" ? (
              <UserBubble key={msg.id} msg={msg} c={c} />
            ) : (
              <AiBubble key={msg.id} msg={msg} c={c} />
            ),
          )}
          {isThinking && <ThinkingBubble c={c} />}
        </ScrollView>

        {/* Action chips */}
        <View style={styles.chips}>
          {CHAT_ACTIONS.map((label, i) => {
            const Icon = ACTION_ICONS[i];
            return (
              <PressableScale
                key={label}
                onPress={() => handleChipAction(label)}
                disabled={isThinking}
                style={[
                  styles.chip,
                  {
                    borderColor: c.chipBorder,
                    backgroundColor: isDark
                      ? "rgba(123,97,255,0.08)"
                      : c.cardSoft,
                    opacity: isThinking ? 0.5 : 1,
                  },
                ]}
                hitSlop={4}
                haptic
              >
                <View
                  style={[
                    styles.chipIcon,
                    { backgroundColor: "rgba(123,97,255,0.18)" },
                  ]}
                >
                  <Icon size={13} color={c.accent} strokeWidth={2.4} />
                </View>
                <Text
                  style={[styles.chipText, { color: c.accent }]}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {/* Divider */}
        <View
          style={[
            styles.divider,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.06)"
                : "rgba(15,23,42,0.06)",
            },
          ]}
        />

        {/* Input bar — premium pill */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: isDark
                ? "rgba(255,255,255,0.05)"
                : "rgba(15,23,42,0.03)",
              borderColor: c.cardBorder,
            },
          ]}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type your message..."
            placeholderTextColor={c.subtle}
            style={[styles.input, { color: c.text }]}
            returnKeyType="send"
            onSubmitEditing={() => sendFromInput(input)}
            blurOnSubmit={false}
            cursorColor={c.accent}
            selectionColor={c.accent}
            editable={!isThinking}
          />

          <Pressable hitSlop={8} style={styles.attachBtn}>
            <ImageIcon size={19} color={c.subtle} strokeWidth={2.2} />
          </Pressable>

          <Pressable
            onPress={() => sendFromInput(input)}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.sendWrap,
              {
                opacity: !canSend ? 0.45 : pressed ? 0.88 : 1,
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
          >
            <LinearGradient
              colors={["#7B61FF", "#4A90E2"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.sendBtn}
            >
              <ArrowUp size={18} color="#FFFFFF" strokeWidth={2.8} />
            </LinearGradient>
          </Pressable>
        </View>
      </AiGlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: aiSpacing.section,
    paddingHorizontal: aiSpacing.screen,
  },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: aiRadius.sm,
    borderWidth: 1,
  },
  newChatLabel: { ...aiType.caption, fontSize: 11, fontWeight: "700" },

  card: {
    borderRadius: aiRadius.xl,
    borderWidth: 1,
    padding: aiSpacing.card,
  },

  /* Messages area */
  msgArea: {
    maxHeight: 280,
  },
  msgContent: {
    paddingBottom: 2,
  },

  /* User bubble — right-aligned, meta below outside bubble */
  userWrap: {
    alignItems: "flex-end",
    marginBottom: 12,
  },
  userBubble: {
    maxWidth: "88%",
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    ...aiType.body,
    fontSize: 13.5,
    fontWeight: "600",
    color: "#FFFFFF",
    lineHeight: 19,
  },
  userMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 5,
    marginRight: 4,
  },
  metaTxt: { fontSize: 10, fontWeight: "600", letterSpacing: 0.2 },

  /* AI bubble — left-aligned with avatar */
  aiRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
    alignItems: "flex-start",
  },
  aiAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  aiAvatar: { width: 32, height: 32 },
  aiCol: { flex: 1, minWidth: 0 },
  aiBubble: {
    alignSelf: "flex-start",
    maxWidth: "96%",
    borderRadius: 18,
    borderTopLeftRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  aiText: {
    ...aiType.body,
    fontSize: 13.5,
    fontWeight: "500",
    lineHeight: 19,
  },
  aiTimeTxt: {
    marginTop: 5,
    marginLeft: 4,
    fontSize: 10,
    fontWeight: "500",
    letterSpacing: 0.2,
  },

  /* Thinking dots */
  thinkingBubble: {
    flexDirection: "row",
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  /* Chips */
  chips: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
  },
  chip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 6,
    borderRadius: aiRadius.md,
    borderWidth: 1,
  },
  chipIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    ...aiType.caption,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: -0.1,
    flexShrink: 1,
  },

  /* Divider */
  divider: {
    height: 1,
    marginVertical: 12,
  },

  /* Input bar */
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 5,
    gap: 6,
  },
  input: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: "500",
    letterSpacing: -0.1,
    paddingVertical: 6,
  },
  attachBtn: {
    padding: 6,
  },
  sendWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: "hidden",
    shadowColor: "#7B61FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 6,
  },
  sendBtn: {
    flex: 1,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
});
