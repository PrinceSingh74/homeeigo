import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { PressableScale } from "@/components/ai/PressableScale";

type Props = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function SectionHeader({ title, actionLabel = "View All", onAction }: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={styles.row}>
      <Text
        style={[profileType.sectionTitle, profileTextBase, { color: c.text, flex: 1 }]}
        numberOfLines={1}
      >
        {title}
      </Text>
      {onAction ? (
        <PressableScale onPress={onAction} haptic style={styles.action}>
          <Text style={[profileType.sectionAction, profileTextBase, { color: c.primary }]}>
            {actionLabel}
          </Text>
          <ChevronRight size={14} color={c.primary} strokeWidth={2.5} />
        </PressableScale>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 12,
  },
  action: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 0 },
});
