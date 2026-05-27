import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
} from "react-native";
import Animated, {
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Search, Mic, Sparkles } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { POPULAR_SEARCHES } from "@/constants/servicesData";
import { serviceType, fontFamily } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesContext } from "./ServicesContext";
import { useServicesActions } from "@/hooks/useServicesActions";
import { Hero3DVisual } from "./visual/Hero3DVisual";
import { GlassSurface } from "./visual/GlassSurface";
import { useServicesTheme } from "./ServicesThemeContext";

type Props = { scrollY: SharedValue<number> };

const TRUST = [
  { icon: "✓", label: "Verified Experts" },
  { icon: "🔒", label: "Background Checked" },
  { icon: "💳", label: "Secure Payments" },
];

export function ServicesHeroSection({ scrollY }: Props) {
  const {
    searchQuery,
    setSearchQuery,
    activePopularSearch,
    setActivePopularSearch,
  } = useServicesContext();
  const { bookFromSearch, openAi } = useServicesActions();
  const { c, shadows, isDark, layout: L } = useServicesTheme();

  const parallax = useAnimatedStyle(() => ({
    transform: [{ translateY: scrollY.value * 0.1 }],
  }));

  return (
    <Animated.View style={parallax}>
      <View style={[styles.gradient, { paddingHorizontal: L.pad }]}>
        <LinearGradient
          colors={[c.heroSheen, "transparent"]}
          style={styles.topSheen}
        />

        <Animated.View
          entering={FadeInDown.delay(80)}
          style={[
            styles.badge,
            {
              backgroundColor: c.badgeBg,
              borderColor: c.badgeBorder,
            },
            shadows.glass,
          ]}
        >
          <Sparkles size={12} color={c.primary} />
          <Text style={[styles.badgeText, { color: c.primary }]}>
            100+ Premium Services · 4K Quality
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100)} style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              {
                color: c.textPrimary,
                fontSize: L.heroTitleSize,
                lineHeight: L.heroTitleLine,
                textShadowColor: isDark
                  ? "rgba(139, 92, 246, 0.25)"
                  : "rgba(108, 58, 232, 0.08)",
              },
            ]}
          >
            Premium Home{"\n"}Services
          </Text>
          <View style={styles.houseSlot}>
            <Hero3DVisual compact />
          </View>
        </Animated.View>

        <Animated.Text
          entering={FadeInDown.delay(180)}
          style={[styles.subtitle, { color: c.textSecondary }]}
        >
          Fast, reliable & AI-powered solutions for your beautiful home.
        </Animated.Text>

        <Animated.View entering={FadeInDown.delay(260)}>
          <GlassSurface borderRadius={layout.cardRadius} style={styles.trustGlass}>
            <View style={styles.trustPanel}>
              {TRUST.map((t) => (
                <View key={t.label} style={styles.trustItem}>
                  <View style={[styles.trustIcon, { backgroundColor: c.lightPurple }]}>
                    <Text style={styles.trustIconText}>{t.icon}</Text>
                  </View>
                  <Text
                    style={[
                      styles.trustLabel,
                      { color: isDark ? c.textSecondary : "#4B5563" },
                    ]}
                    numberOfLines={1}
                  >
                    {t.label}
                  </Text>
                </View>
              ))}
            </View>
          </GlassSurface>
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(300)} style={styles.searchWrap}>
          <GlassSurface
            borderRadius={layout.cardRadius + 2}
            style={[styles.searchGlass, shadows.soft]}
          >
            <View style={[styles.searchBar, { height: L.searchHeight }]}>
              <Search size={20} color={c.textMuted} strokeWidth={2} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search cleaning, AC repair, plumbing..."
                placeholderTextColor={c.textMuted}
                style={[styles.searchInput, { color: c.textPrimary }]}
              />
              <PressableScale
                scaleTo={0.92}
                haptic
                style={[styles.micBtn, { backgroundColor: c.chipBg }]}
                onPress={openAi}
              >
                <Mic size={19} color={c.textSecondary} />
              </PressableScale>
              <PressableScale
                style={styles.searchBtn}
                scaleTo={0.92}
                haptic
                onPress={() => bookFromSearch(searchQuery || "cleaning")}
              >
                <LinearGradient
                  colors={[c.primary, c.accentPurple]}
                  style={[styles.searchBtnGrad, shadows.soft]}
                >
                  <Search size={18} color="#fff" strokeWidth={2.5} />
                </LinearGradient>
              </PressableScale>
            </View>
          </GlassSurface>

          <Text style={[styles.popularLabel, { color: c.textMuted }]}>
            Popular searches
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[
              styles.chipsRow,
              { paddingRight: L.listPeek },
            ]}
          >
            {POPULAR_SEARCHES.map((chip) => {
              const active = activePopularSearch === chip;
              return (
                <PressableScale
                  key={chip}
                  haptic
                  onPress={() => {
                    setActivePopularSearch(active ? null : chip);
                    setSearchQuery(chip);
                  }}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? c.primary : c.badgeBg,
                      borderColor: active ? c.primary : c.chipBorder,
                    },
                    shadows.glass,
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? "#fff" : c.primary },
                    ]}
                  >
                    {chip}
                  </Text>
                </PressableScale>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  gradient: {
    paddingTop: 8,
    paddingBottom: 36,
    overflow: "hidden",
  },
  topSheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    borderRadius: layout.chipRadius,
    paddingHorizontal: 14,
    paddingVertical: 7,
    marginBottom: 16,
    borderWidth: 1,
  },
  badgeText: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    letterSpacing: 0.15,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
    gap: 4,
  },
  houseSlot: {
    flexShrink: 0,
    marginTop: -6,
    marginRight: -4,
  },
  title: {
    ...serviceType.heroTitle,
    flex: 1,
    flexShrink: 1,
    paddingRight: 6,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  subtitle: {
    ...serviceType.heroSubtitle,
    marginTop: 8,
    marginBottom: 4,
    paddingRight: 4,
  },
  trustGlass: { marginTop: 16 },
  trustPanel: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    padding: 12,
  },
  trustItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexBasis: "47%",
    flexGrow: 1,
    minWidth: "46%",
    maxWidth: "100%",
  },
  trustIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  trustIconText: { fontSize: 10 },
  trustLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 10,
    flex: 1,
  },
  searchWrap: { marginTop: 24 },
  searchGlass: { overflow: "hidden" },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 16,
    paddingRight: 8,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fontFamily.regular,
    fontSize: 14,
    paddingVertical: 0,
  },
  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtn: { borderRadius: 21, overflow: "hidden" },
  searchBtnGrad: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  popularLabel: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
    marginTop: 16,
    letterSpacing: 0.25,
  },
  chipsRow: {
    gap: 10,
    marginTop: 10,
  },
  chip: {
    borderRadius: layout.chipRadius,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: fontFamily.medium,
    fontSize: 12,
  },
});
