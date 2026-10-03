import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Text, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAiTheme, aiSpacing, aiType, aiRadius } from "@/lib/ai-mobile-theme";
import { useAiChat } from "@/lib/use-ai-chat";
import { AiChatBlock } from "./AiChatBlock";
import { PressableScale } from "./PressableScale";
import { RotateCcw } from "lucide-react-native";

export function AiChatScreen() {
  const { messages, isThinking, sendText, resetChat } = useAiChat();
  const { c, isDark } = useAiTheme();

  // Scroll handling deliberately lives in AiChatBlock, which owns the transcript list. The
  // FlatList ref and its two scrollToEnd effects were removed with the duplicated list.
  const handleSend = async (text: string) => {
    try {
      await sendText(text);
    } catch (err) {
      // The promise is floated by the composer adapter below, so a rejection here would escape as
      // an unhandled promise rejection with nothing to catch it. `useAiChat` shows the user its own
      // error bubble on failure; this only records what got past it.
      console.warn("[AiChatScreen] send failed", err);
    }
  };

  const isEmpty = messages.length === 1 && messages[0]?.id === "welcome";

  return (
    <LinearGradient
      colors={isDark ? ["#030814", "#0b0f1f"] : ["#f0fdf4", "#f8fafc"]}
      style={styles.container}
    >
      <View style={styles.header}>
        <Text style={[styles.headerTitle, { color: c.text }]}>Homeeigo AI</Text>
        {!isEmpty && (
          <PressableScale
            onPress={resetChat}
            style={[styles.resetBtn, { backgroundColor: c.card, borderColor: c.cardBorder }]}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Clear chat"
          >
            <RotateCcw size={16} color={c.muted} strokeWidth={2} />
          </PressableScale>
        )}
      </View>

      {/*
        Delegates to AiChatBlock rather than re-implementing the transcript.
        AiChatBlock owns message bubbles, the thinking indicator and the composer — its bubble
        renderers (UserBubble/AiBubble/ThinkingBubble) are module-private, so they cannot be driven
        per-message from outside. This screen previously passed `<AiChatBlock message={item} />`
        into a FlatList, which never type-checked: AiChatBlock's props are the whole-chat shape
        ({ messages, isThinking, onSend, onReset }), not a single message.

        The onSend adapter mirrors the live tab (app/(tabs)/ai.tsx): AiComposerBar's contract is
        synchronous `(text) => boolean`, while `sendText` is async, so the promise is deliberately
        floated and acceptance reported immediately.
      */}
      <AiChatBlock
        messages={messages}
        isThinking={isThinking}
        onSend={(text) => {
          void handleSend(text);
          return true;
        }}
        onReset={resetChat}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#030814",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: aiSpacing.screen,
    paddingTop: Platform.OS === "ios" ? 12 : 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(16, 185, 129, 0.15)",
  },
  headerTitle: {
    ...aiType.h2,
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  resetBtn: {
    width: 36,
    height: 36,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  messageList: {
    flexGrow: 1,
    paddingHorizontal: aiSpacing.screen,
    paddingVertical: aiSpacing.screen,
    gap: aiSpacing.gap,
  },
  thinkingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: aiSpacing.gapSm,
    marginHorizontal: aiSpacing.screen,
    marginBottom: aiSpacing.gap,
    paddingHorizontal: aiSpacing.gap,
    paddingVertical: aiSpacing.gapSm,
    borderRadius: aiRadius.lg,
  },
  thinkingText: {
    ...aiType.body,
    fontSize: 13,
  },
});
