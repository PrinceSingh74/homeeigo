import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { ChevronRight, Lightbulb, Snowflake, Sparkles, Wallet } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PROFILE_INSIGHTS } from "@/lib/profile-mobile-data";
import { profileInsightCardWidth } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";

const ICONS = {
  snowflake: Snowflake,
  brush: Sparkles,
  wallet: Wallet,
} as const;

type Props = {
  onViewAll: () => void;
  onInsight: (id: string) => void;
};

export function ProfileInsightsSection({ onViewAll, onInsight }: Props) {
  const { colors: c } = useTheme();
  const { width } = useWindowDimensions();
  const cardW = profileInsightCardWidth(width);

  return (
    <Animated.View entering={profileEnter.section} style={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.titleWithIcon}>
          <Lightbulb size={18} color={c.primary} strokeWidth={2.2} />
          <Text
            style={[profileType.sectionTitle, profileTextBase, { color: c.text, flex: 1 }]}
            numberOfLines={1}
          >
            AI Home Insights
          </Text>
        </View>
        <PressableScale onPress={onViewAll} haptic style={styles.viewAll}>
          <Text style={[profileType.sectionAction, profileTextBase, { color: c.primary }]}>
            View All
          </Text>
          <ChevronRight size={14} color={c.primary} strokeWidth={2.5} />
        </PressableScale>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        decelerationRate="fast"
      >
        {PROFILE_INSIGHTS.map((item, i) => {
          const Icon = ICONS[item.icon];
          return (
            <Animated.View key={item.id} entering={profileEnter.row(i)}>
              <PressableScale
                onPress={() => onInsight(item.id)}
                haptic
                style={[
                  styles.card,
                  {
                    width: cardW,
                    backgroundColor: item.bg,
                    borderColor: item.border,
                  },
                ]}
              >
                <View style={[styles.iconBox, { backgroundColor: item.iconBg }]}>
                  <Icon size={22} color="#fff" strokeWidth={2} />
                </View>
                <Text
                  style={[profileType.insightTitle, profileTextBase, { color: c.text }]}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                <Text
                  style={[profileType.insightSub, profileTextBase, { color: c.textSecondary }]}
                  numberOfLines={2}
                >
                  {item.subtitle}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 12,
  },
  titleWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
  scroll: { gap: 12, paddingRight: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    minHeight: 140,
    justifyContent: "flex-start",
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
});
