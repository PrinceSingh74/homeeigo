import React from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";

/** Consistent back-header used by the secondary customer screens. */
export function ScreenHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  const { colors: c } = useTheme();
  const router = useRouter();
  return (
    <SafeAreaView edges={["top"]} style={{ backgroundColor: c.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10, backgroundColor: c.cardBg, borderWidth: 1, borderColor: c.border }}
        >
          <Text style={{ color: c.text, fontWeight: "700" }}>‹</Text>
        </Pressable>
        <Text style={{ flex: 1, fontSize: 18, fontWeight: "700", color: c.text }}>{title}</Text>
        {right}
      </View>
    </SafeAreaView>
  );
}
