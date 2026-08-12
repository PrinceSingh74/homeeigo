import React from "react";
import { ScrollView, Text, View, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { LEGAL_VERSION, legalSections, type LegalPolicyKey } from "@/lib/legal/content";

export function LegalScreen({ policy }: { policy: LegalPolicyKey }) {
  const router = useRouter();
  const { colors: c } = useTheme();
  const doc = legalSections[policy];

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Go back">
          <ChevronLeft size={22} color={c.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: c.text }]}>{doc.title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.version, { color: c.textSecondary }]}>Effective {LEGAL_VERSION}</Text>
        {doc.sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={[styles.heading, { color: c.text }]}>{s.heading}</Text>
            <Text style={[styles.body, { color: c.textSecondary }]}>{s.body}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingTop: 52,
    paddingBottom: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: "700", flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  version: { fontSize: 12, marginBottom: 16 },
  section: { marginBottom: 20 },
  heading: { fontSize: 16, fontWeight: "700", marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 21 },
});
