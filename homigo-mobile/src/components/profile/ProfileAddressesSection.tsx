import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { Plus } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PROFILE_ADDRESSES } from "@/lib/profile-mobile-data";
import { profileAddressCardWidth } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";
import { SectionHeader } from "@/components/profile/SectionHeader";

type Props = {
  onManage: () => void;
  onAddress: (id: string) => void;
  onAdd: () => void;
};

export function ProfileAddressesSection({ onManage, onAddress, onAdd }: Props) {
  const { colors: c, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const cardW = profileAddressCardWidth(width);

  return (
    <Animated.View entering={profileEnter.section} style={styles.wrap}>
      <SectionHeader title="Saved Addresses" onAction={onManage} actionLabel="Manage" />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        decelerationRate="fast"
      >
        {PROFILE_ADDRESSES.map((addr, i) => {
          if (addr.type === "add") {
            return (
              <Animated.View key="add" entering={profileEnter.row(i)}>
                <PressableScale
                  onPress={onAdd}
                  haptic
                  style={[
                    styles.addCard,
                    {
                      width: cardW,
                      borderColor: c.border,
                      backgroundColor: isDark ? c.cardBg : "#F9FAFB",
                    },
                  ]}
                >
                  <View style={[styles.addIcon, { backgroundColor: "#EFF6FF" }]}>
                    <Plus size={22} color={c.primary} strokeWidth={2.5} />
                  </View>
                  <Text
                    style={[profileType.addressAdd, profileTextBase, { color: c.primary }]}
                    numberOfLines={2}
                  >
                    Add New Address
                  </Text>
                </PressableScale>
              </Animated.View>
            );
          }

          return (
            <Animated.View key={addr.id} entering={profileEnter.row(i)}>
              <PressableScale
                onPress={() => onAddress(addr.id)}
                haptic
                style={[
                  styles.card,
                  {
                    width: cardW,
                    backgroundColor: c.cardBg,
                    borderColor: isDark ? c.border : "#E5E7EB",
                  },
                  shadowStyles.sm,
                ]}
              >
                <View style={[styles.tag, { backgroundColor: addr.tagBg }]}>
                  <Text
                    style={[profileType.addressTag, profileTextBase, { color: addr.tagColor }]}
                  >
                    {addr.type} · {addr.tag}
                  </Text>
                </View>
                <Text
                  style={[profileType.addressLine, profileTextBase, { color: c.text }]}
                  numberOfLines={2}
                >
                  {addr.line1}
                </Text>
                <Text
                  style={[profileType.addressLine, profileTextBase, { color: c.textSecondary }]}
                  numberOfLines={2}
                >
                  {addr.line2}
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
  wrap: { marginBottom: spacing.md },
  scroll: { gap: 12, paddingRight: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    minHeight: 118,
    gap: 6,
  },
  tag: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    marginBottom: 4,
  },
  addCard: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    padding: 14,
    minHeight: 118,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  addIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
