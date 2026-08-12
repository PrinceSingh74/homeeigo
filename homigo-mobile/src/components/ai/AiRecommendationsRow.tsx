import React from "react";
import { ScrollView, View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { openBook } from "@/lib/navigation";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { getServicePhoto } from "@/lib/service-photos";

export function AiRecommendationsRow() {
  const router = useRouter();
  const { openAiRecommendations } = useAppNavigation();
  const { c, isDark } = useAiTheme();
  const { aiRecommendations } = useServicesDiscovery();

  return (
    <View style={styles.wrap}>
      <SectionTitle
        // Honest framing: this is a curated shortcut row, not a per-user model
        // output. Calling it "personalised" implied an AI prediction the app does
        // not make — the copy now matches what the list actually is.
        title="Popular home services"
        subtitle="Tap to explore and book"
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
        {aiRecommendations.map((item) => {
          const photo = getServicePhoto(item.title);
          return (
          <PressableScale
            key={item.id}
            style={[styles.cardOuter, aiCardShadow(c.shadowColor, "lift")]}
            onPress={() => openBook(router, { service: item.serviceId })}
            haptic
            accessibilityRole="button"
            accessibilityLabel={`Book ${item.title}`}
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
              <View style={[styles.iconBox, { borderColor: `${c.accent}44` }]}>
                {photo ? (
                  <Image source={photo.photo} style={styles.iconImg} resizeMode="cover" />
                ) : (
                  <LinearGradient
                    colors={[`${c.accent}55`, `${c.accent}22`]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={styles.iconFill}
                  >
                    <Text style={{ fontSize: 24 }}>{item.emoji}</Text>
                  </LinearGradient>
                )}
              </View>

              <View style={styles.body}>
                <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.note, { color: c.subtle }]} numberOfLines={2}>
                  {item.desc}
                </Text>
              </View>

              <LinearGradient
                colors={["#2dd4bf", "#10b981", "#0d9488"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.bookBtn, aiCardShadow("#10b981", "glow")]}
              >
                <Text style={styles.bookText}>Book Now</Text>
              </LinearGradient>
            </View>
          </PressableScale>
          );
        })}
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
  iconImg: { width: "100%", height: "100%" },
  iconFill: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
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
