import React from "react";
import { ScrollView, View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SectionTitle } from "./SectionTitle";
import { PressableScale } from "./PressableScale";
import { useFeaturedCatalog } from "@/hooks/use-catalog";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { openBook } from "@/lib/navigation";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { getServicePhoto } from "@/lib/service-photos";

export function AiQuickActionsRow() {
  const router = useRouter();
  const { goServices } = useAppNavigation();
  const { c, isDark } = useAiTheme();
  const { featured } = useFeaturedCatalog();
  const actions = featured.slice(0, 6).map((s) => ({
    label: s.name,
    serviceId: s.id,
    photo: getServicePhoto(s.name),
  }));

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
        {actions.map((item) => (
          <PressableScale
            key={item.label}
            onPress={() => openBook(router, { service: item.serviceId })}
            haptic
            style={[styles.tileOuter, aiCardShadow(c.shadowColor, "lift")]}
            accessibilityRole="button"
            accessibilityLabel={`Book ${item.label}`}
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
              <View style={[styles.iconBox, { borderColor: `${c.accent}44` }]}>
                {item.photo ? (
                  <Image source={item.photo.photo} style={styles.iconImg} resizeMode="cover" />
                ) : (
                  <LinearGradient
                    colors={[`${c.accent}55`, `${c.accent}22`]}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                    style={styles.iconFill}
                  >
                    <Text style={{ fontSize: 22 }}>🏠</Text>
                  </LinearGradient>
                )}
              </View>
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
  iconImg: { width: "100%", height: "100%" },
  iconFill: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    ...aiType.caption,
    marginTop: 9,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.1,
  },
});
