import React from "react";
import { ScrollView, View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";
import { QUICK_ACTIONS } from "@/lib/ai-mobile-data";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { openBook } from "@/lib/navigation";
import { useAppNavigation } from "@/hooks/useAppNavigation";

export function AiQuickActionsRow() {
  const router = useRouter();
  const { goServices } = useAppNavigation();
  const { c, isDark } = useAiTheme();

  return (
    <View style={styles.wrap}>
      <SectionTitle
        title="Quick Actions"
        subtitle="Book in one tap"
        onViewAll={goServices}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        decelerationRate="fast"
        snapToInterval={88 + 10}
        snapToAlignment="start"
      >
        {QUICK_ACTIONS.map((item) => (
          <PressableScale
            key={item.label}
            onPress={() => openBook(router, { service: item.serviceId })}
            haptic
            style={[styles.tileOuter, aiCardShadow(c.shadowColor, "lift")]}
          >
            <View
              style={[
                styles.tile,
                {
                  backgroundColor: c.card,
                  borderColor: c.cardBorderStrong,
                },
              ]}
            >
              <LinearGradient
                colors={
                  isDark
                    ? ["rgba(255,255,255,0.08)", "transparent"]
                    : ["rgba(255,255,255,0.9)", "transparent"]
                }
                style={styles.tileShine}
                pointerEvents="none"
              />
              <LinearGradient
                colors={item.tint}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={[
                  styles.iconBox,
                  {
                    borderColor: `${item.accent}44`,
                    shadowColor: item.accent,
                  },
                  aiCardShadow(item.accent, "glow"),
                ]}
              >
                <Image source={item.image} style={styles.icon} resizeMode="contain" />
              </LinearGradient>
              <Text style={[styles.label, { color: c.text }]} numberOfLines={1}>
                {item.label}
              </Text>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: aiSpacing.section },
  scroll: {
    paddingHorizontal: aiSpacing.screen,
    gap: 10,
    paddingVertical: 4,
  },
  tileOuter: { borderRadius: aiRadius.lg },
  tile: {
    width: 88,
    paddingTop: 12,
    paddingBottom: 11,
    paddingHorizontal: 8,
    borderRadius: aiRadius.lg,
    borderWidth: 1,
    alignItems: "center",
    overflow: "hidden",
  },
  tileShine: {
    ...StyleSheet.absoluteFillObject,
    height: "45%",
  },
  iconBox: {
    width: 58,
    height: 58,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
  },
  icon: { width: 48, height: 48 },
  label: {
    ...aiType.caption,
    marginTop: 9,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.1,
  },
});
