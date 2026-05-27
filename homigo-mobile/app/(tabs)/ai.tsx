import React, { useRef, useCallback } from "react";
import {
  ScrollView,
  StyleSheet,
  View,
  StatusBar,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { AiPageAmbient } from "@/components/ai/AiPageAmbient";
import { AiNeonTopEdge } from "@/components/ai/ai-primitives";
import { AiScreenHeader } from "@/components/ai/AiScreenHeader";
import { AiHeroCard } from "@/components/ai/AiHeroCard";
import { AiQuickActionsRow } from "@/components/ai/AiQuickActionsRow";
import { AiChatBlock } from "@/components/ai/AiChatBlock";
import { AiBookingBlock } from "@/components/ai/AiBookingBlock";
import { AiRecommendationsRow } from "@/components/ai/AiRecommendationsRow";
import { AiComposerBar } from "@/components/ai/AiComposerBar";
import { useAiTheme } from "@/lib/ai-mobile-theme";
import { useAiChat } from "@/lib/use-ai-chat";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";
import {
  TAB_MENU_GAP,
  composerKeyboardPadding,
} from "@/lib/composer-layout";

const SCROLL_END_GAP = 20;

export default function AIScreen() {
  const { c, isDark } = useAiTheme();
  const scrollRef = useRef<ScrollView>(null);
  const keyboardInset = useKeyboardInset();
  const keyboardPad = composerKeyboardPadding(keyboardInset);
  const { messages, isThinking, sendText, resetChat } = useAiChat();

  const onComposerFocus = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const onComposerSend = useCallback(
    (text: string) => {
      const sent = sendText(text);
      if (sent) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollToEnd({ animated: true });
        });
      }
      return sent;
    },
    [sendText],
  );

  return (
    <View style={[styles.page, { backgroundColor: c.bg }]}>
      <LinearGradient
        colors={[...c.pageBg]}
        locations={isDark ? [0, 0.35, 0.7, 1] : [0, 0.5, 1]}
        style={StyleSheet.absoluteFill}
      />
      <AiPageAmbient />

      <SafeAreaView style={styles.safe} edges={["top"]}>
        <StatusBar barStyle={isDark ? "light-content" : "dark-content"} backgroundColor={c.bg} />

        <View style={styles.root}>
          <AiScreenHeader />

          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            nestedScrollEnabled
            decelerationRate="normal"
          >
            <AiHeroCard />
            <AiQuickActionsRow />
            <AiChatBlock
              messages={messages}
              isThinking={isThinking}
              onSend={sendText}
              onReset={resetChat}
            />
            <AiBookingBlock />
            <AiRecommendationsRow />
            <View style={{ height: SCROLL_END_GAP }} />
          </ScrollView>

          <View
            style={[
              styles.composerDock,
              {
                marginBottom: TAB_MENU_GAP,
                paddingBottom: keyboardPad,
              },
            ]}
          >
            <LinearGradient
              colors={
                isDark
                  ? ["transparent", "rgba(3,2,8,0.85)", c.bg]
                  : ["transparent", "rgba(238,242,250,0.9)", c.bg]
              }
              style={styles.composerFade}
              pointerEvents="none"
            />
            <AiNeonTopEdge />
            <AiComposerBar
              onFocus={onComposerFocus}
              keyboardVisible={keyboardInset > 0}
              onSend={onComposerSend}
              sendDisabled={isThinking}
            />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  safe: { flex: 1 },
  root: {
    flex: 1,
    flexDirection: "column",
  },
  scroll: {
    flex: 1,
    flexShrink: 1,
  },
  scrollContent: {
    paddingTop: 8,
    flexGrow: 1,
  },
  composerDock: {
    flexShrink: 0,
    paddingTop: 10,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#7B61FF",
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.2,
        shadowRadius: 20,
      },
      android: { elevation: 16 },
    }),
  },
  composerFade: {
    position: "absolute",
    left: 0,
    right: 0,
    top: -48,
    height: 48,
  },
});
