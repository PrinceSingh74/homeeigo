import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { spacing, type, radius } from "@/lib/typography";

type Props = {
  title: string;
  subtitle?: string;
  badge?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export function AuthPageShell({ title, subtitle, badge, footer, children }: Props) {
  const router = useRouter();
  const { colors: c } = useTheme();

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <ArrowLeft size={22} color={c.text} />
        </Pressable>
      </View>
      <View style={styles.content}>
        {badge ? (
          <Text style={[styles.badge, { color: c.primary, backgroundColor: `${c.primary}18` }]}>
            {badge}
          </Text>
        ) : null}
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>{subtitle}</Text>
        ) : null}
        {children}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    overflow: "hidden",
    ...type.overline,
    marginBottom: spacing.sm,
  },
  title: { ...type.headline, marginBottom: spacing.xs },
  subtitle: { ...type.body, marginBottom: spacing.xl, lineHeight: 22 },
  footer: { marginTop: spacing.xl, paddingBottom: spacing.lg },
});
