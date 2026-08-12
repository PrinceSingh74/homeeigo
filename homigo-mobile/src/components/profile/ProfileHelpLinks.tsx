import React from "react";
import { View, Text, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";

const LINKS: { label: string; href: string }[] = [
  { label: "Support tickets", href: "/support" },
  { label: "Invoices", href: "/invoices" },
];

/** Profile footer links to the secondary customer screens (parity with web). */
export function ProfileHelpLinks() {
  const { colors: c } = useTheme();
  const router = useRouter();
  return (
    <View style={{ marginTop: 12, backgroundColor: c.cardBg, borderRadius: 16, borderWidth: 1, borderColor: c.border, overflow: "hidden" }}>
      {LINKS.map((l, i) => (
        <Pressable
          key={l.href}
          onPress={() => router.push(l.href as never)}
          style={{ paddingHorizontal: 16, paddingVertical: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}
        >
          <Text style={{ color: c.text, fontWeight: "600" }}>{l.label}</Text>
          <Text style={{ color: c.textSecondary, fontSize: 18 }}>›</Text>
        </Pressable>
      ))}
    </View>
  );
}
