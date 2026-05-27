import React from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PROFILE_STAT_CARDS } from "@/lib/profile-mobile-data";
import { profileStatTileWidth } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";

type Props = {
  onStatPress: (id: string, route?: string) => void;
};

export function ProfileQuickStatsGrid({ onStatPress }: Props) {
  const { colors: c, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const tileW = profileStatTileWidth(width);

  return (
    <View style={styles.grid}>
      {PROFILE_STAT_CARDS.map((card, i) => {
        const Icon = card.icon;
        return (
          <Animated.View
            key={card.id}
            entering={profileEnter.stat(i)}
            style={{ width: tileW }}
          >
            <PressableScale
              onPress={() => onStatPress(card.id, card.route)}
              haptic
              style={[
                styles.tile,
                {
                  backgroundColor: c.cardBg,
                  borderColor: isDark ? c.border : "#E5E7EB",
                },
                shadowStyles.md,
              ]}
            >
              <LinearGradient colors={[...card.gradient]} style={styles.iconWrap}>
                <Icon size={20} color="#fff" strokeWidth={2} />
              </LinearGradient>
              <Text
                style={[profileType.tileLabel, profileTextBase, { color: c.textSecondary }]}
                numberOfLines={2}
              >
                {card.label}
              </Text>
              <Text
                style={[
                  profileType.tileValue,
                  profileTextBase,
                  { color: c.text, marginTop: 6, marginBottom: 4 },
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {card.value}
              </Text>
              <View style={styles.linkRow}>
                <Text
                  style={[
                    profileType.tileLink,
                    profileTextBase,
                    { color: card.linkColor ?? c.primary },
                  ]}
                  numberOfLines={1}
                >
                  {card.link}
                </Text>
                <ChevronRight
                  size={12}
                  color={card.linkColor ?? c.primary}
                  strokeWidth={2.5}
                />
              </View>
            </PressableScale>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: spacing.xl,
  },
  tile: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
    minHeight: 132,
    justifyContent: "flex-start",
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: "auto",
    paddingTop: 8,
    gap: 0,
  },
});
