import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { PressableScale } from "@/components/ai/PressableScale";
import { CATEGORIES } from "@/constants/servicesData";
import { SectionHeader } from "./common/SectionHeader";
import { fontFamily } from "@/theme/typography";
import { useServicesContext } from "./ServicesContext";
import { useServicesActions } from "@/hooks/useServicesActions";
import { Premium3DIcon } from "./visual/Premium3DIcon";
import { useServicesTheme } from "./ServicesThemeContext";

export function CategoriesSection() {
  const { activeCategoryId, setActiveCategoryId } = useServicesContext();
  const { openCategories, book } = useServicesActions();
  const { c, layout: L } = useServicesTheme();

  return (
    <View>
      <SectionHeader
        overline="Explore"
        title="Browse by Categories"
        subtitle="Tap a category to filter trending services"
        viewAllLabel="View All →"
        onViewAll={openCategories}
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={L.listContent}
      >
        {CATEGORIES.map((cat, index) => {
          const active = activeCategoryId === cat.id;
          return (
            <Animated.View
              key={cat.id}
              entering={FadeInDown.delay(index * 45).springify()}
            >
              <PressableScale
                scaleTo={0.94}
                haptic
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                    () => {},
                  );
                  if (active) {
                    setActiveCategoryId(null);
                  } else {
                    setActiveCategoryId(cat.id);
                    book({ service: cat.serviceId });
                  }
                }}
                style={[styles.card, { width: L.categoryW }]}
              >
                <Premium3DIcon
                  emoji={cat.emoji}
                  bgColor={cat.bgColor}
                  active={active}
                  size={L.categoryIcon}
                />
                <Text
                  style={[
                    styles.name,
                    { color: c.textPrimary },
                    active && { color: c.primary },
                  ]}
                >
                  {cat.name}
                </Text>
                <Text style={[styles.count, { color: c.textMuted }]}>
                  {cat.count} services
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    paddingTop: 4,
    paddingBottom: 8,
  },
  name: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    textAlign: "center",
    marginTop: 12,
    letterSpacing: -0.15,
  },
  count: {
    fontFamily: fontFamily.regular,
    fontSize: 10,
    marginTop: 3,
  },
});
