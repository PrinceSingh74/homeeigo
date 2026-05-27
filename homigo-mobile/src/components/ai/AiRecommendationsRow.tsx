import React from "react";
import { ScrollView, View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";
import { RECOMMENDATIONS } from "@/lib/ai-mobile-data";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { openBook } from "@/lib/navigation";
import { useAppNavigation } from "@/hooks/useAppNavigation";

export function AiRecommendationsRow() {
  const router = useRouter();
  const { openAiRecommendations } = useAppNavigation();
  const { c, isDark } = useAiTheme();

  return (
    <View style={styles.wrap}>
      <SectionTitle
        title="AI Recommendations for You"
        subtitle="Personalized for your home"
        onViewAll={openAiRecommendations}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        decelerationRate="fast"
        snapToInterval={136 + 10}
        snapToAlignment="start"
      >
        {RECOMMENDATIONS.map((item) => (
          <PressableScale
            key={item.title}
            style={[styles.cardOuter, aiCardShadow(c.shadowColor, "lift")]}
            onPress={() => openBook(router, { service: item.serviceId })}
            haptic
          >
            <View
              style={[
                styles.card,
                {
                  backgroundColor: c.card,
                  borderColor: c.cardBorderStrong,
                },
              ]}
            >
              <LinearGradient
                colors={
                  isDark
                    ? ["rgba(255,255,255,0.07)", "transparent"]
                    : ["rgba(255,255,255,0.95)", "transparent"]
                }
                style={styles.cardShine}
                pointerEvents="none"
              />
              <LinearGradient
                colors={item.tint}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={[
                  styles.iconBox,
                  { borderColor: `${item.accent}44` },
                  aiCardShadow(item.accent, "glow"),
                ]}
              >
                <Image source={item.image} style={styles.icon} resizeMode="contain" />
              </LinearGradient>

              <View style={styles.body}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.note, { color: c.subtle }]} numberOfLines={2}>
                  {item.note}
                </Text>
              </View>

              <LinearGradient
                colors={["#00D1FF", "#7B61FF", "#6366F1"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.bookBtn, aiCardShadow("#7B61FF", "glow")]}
              >
                <Text style={styles.bookText}>Book Now</Text>
              </LinearGradient>
            </View>
          </PressableScale>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: aiSpacing.section + 8 },
  scroll: {
    paddingHorizontal: aiSpacing.screen,
    gap: 10,
    paddingVertical: 4,
  },
  cardOuter: { borderRadius: aiRadius.xl },
  card: {
    width: 136,
    borderRadius: aiRadius.xl,
    borderWidth: 1,
    padding: 14,
    paddingTop: 16,
    alignItems: "center",
    overflow: "hidden",
  },
  cardShine: {
    ...StyleSheet.absoluteFillObject,
    height: "40%",
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
  },
  icon: { width: 50, height: 50 },
  body: {
    width: "100%",
    marginTop: 12,
    minHeight: 44,
  },
  cardTitle: {
    ...aiType.smallStrong,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.25,
  },
  note: {
    ...aiType.caption,
    fontSize: 10,
    fontWeight: "500",
    marginTop: 4,
    lineHeight: 14,
  },
  bookBtn: {
    width: "100%",
    height: 34,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
  },
  bookText: {
    ...aiType.caption,
    fontSize: 11,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: -0.1,
  },
});
