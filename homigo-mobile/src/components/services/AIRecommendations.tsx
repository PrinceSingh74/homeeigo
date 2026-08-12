import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, { SlideInRight } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Sparkles } from "lucide-react-native";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";
import { SectionHeader } from "./common/SectionHeader";
import { BookNowButton } from "./common/BookNowButton";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { useServicesTheme } from "./ServicesThemeContext";

function cardColors(
  isDark: boolean,
  bgFrom: string,
  bgTo: string,
): [string, string] {
  if (!isDark) return [bgFrom, bgTo];
  return ["#1E1830", "#141024"];
}

export function AIRecommendations() {
  const { book, openAiRecommendations } = useServicesActions();
  const { c, shadows, isDark, layout: L } = useServicesTheme();
  const { aiRecommendations } = useServicesDiscovery();

  return (
    <View>
      <SectionHeader
        overline="Smart picks"
        title="AI Recommendations for You"
        subtitle="Personalized based on your home & usage patterns"
        onViewAll={openAiRecommendations}
        leading={
          <View style={[styles.sparkleWrap, { backgroundColor: c.lightPurple }]}>
            <Sparkles size={13} color={c.primary} strokeWidth={2.5} />
          </View>
        }
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={L.listContent}
      >
        {aiRecommendations.map((item, index) => (
          <Animated.View
            key={item.id}
            entering={SlideInRight.delay(index * 70).springify().damping(18)}
          >
            <LinearGradient
              colors={cardColors(isDark, item.bgFrom, item.bgTo)}
              style={[
                styles.card,
                shadows.medium,
                { width: L.aiCardW, borderColor: c.cardBorder },
              ]}
            >
              <View style={styles.cardTop}>
                <Text style={[styles.cardTitle, { color: c.textPrimary }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View
                  style={[
                    styles.emojiWrap,
                    { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.65)" },
                  ]}
                >
                  <Text style={styles.emoji}>{item.emoji}</Text>
                </View>
              </View>
              <Text style={[styles.desc, { color: c.textSecondary }]} numberOfLines={3}>
                {item.desc}
              </Text>
              {item.urgent ? (
                <View style={styles.urgentBadge}>
                  <Text style={styles.urgentText}>Seasonal alert</Text>
                </View>
              ) : null}
              <BookNowButton
                compact
                style={styles.bookBtn}
                onPress={() => book({ service: item.serviceId })}
              />
            </LinearGradient>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sparkleWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: layout.cardRadius,
    padding: 16,
    minHeight: 178,
    borderWidth: 1,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 2,
  },
  cardTitle: {
    ...serviceType.cardTitleSm,
    flex: 1,
    paddingRight: 10,
  },
  emojiWrap: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: { fontSize: 28 },
  desc: {
    ...serviceType.caption,
    marginTop: 6,
    lineHeight: 17,
  },
  urgentBadge: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  urgentText: {
    ...serviceType.badge,
    color: "#F87171",
    fontSize: 9,
  },
  bookBtn: { marginTop: 12, width: "100%" },
});
