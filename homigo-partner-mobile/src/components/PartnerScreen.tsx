import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import type { ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { color, radius, space, touch } from "@/theme/tokens";

type PartnerScreenProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Pinned under the scroll: the screen's primary action lives here, in reach of the thumb. */
  footer?: ReactNode;
  showBack?: boolean;
  onBack?: () => void;
  /** A small control at the right of the title row (a status pill, a settings button). */
  headerAction?: ReactNode;
  /** Pull to refresh, when the screen's data can be asked for again. */
  refreshing?: boolean;
  onRefresh?: () => void;
};

/**
 * The frame every partner screen sits in: paper background, a plain title the screen reader
 * announces as the heading, an optional back control, scrolling content and a docked footer.
 */
export function PartnerScreen({ title, subtitle, children, footer, showBack, onBack, headerAction, refreshing, onRefresh }: PartnerScreenProps) {
  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={footer ? ["top", "bottom"] : ["top"]}>
        {/* Pads by the keyboard's real overlap (nothing where the window already resized), so a field low on the page and the docked footer stay above it. */}
        <KeyboardAvoidingView behavior="padding" style={styles.safe}>
        {/* "handled": a tap on a button while the keyboard is open reaches the button (X-69) instead of only dismissing the keyboard. */}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[styles.scroll, footer ? styles.scrollWithFooter : null]}
          showsVerticalScrollIndicator={false}
          refreshControl={onRefresh ? <RefreshControl refreshing={Boolean(refreshing)} onRefresh={onRefresh} tintColor={color.leaf} colors={[color.leaf]} /> : undefined}
        >
          {showBack ? (
            <Pressable
              onPress={() => (onBack ? onBack() : router.back())}
              style={({ pressed }) => [styles.backBtn, pressed ? styles.backPressed : null]}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
            >
              <ChevronLeft color={color.leaf} size={22} />
              <T kind="bodyStrong" tone="leaf">
                Back
              </T>
            </Pressable>
          ) : null}
          <View style={styles.header}>
            <View style={styles.headerText}>
              <T kind="caption" tone="leaf" accessibilityLabel="HOMEEIGO Partner" style={styles.brand}>
                HOMEEIGO Partner
              </T>
              <T kind="display" accessibilityRole="header">
                {title}
              </T>
              {subtitle ? (
                <T kind="body" tone="slate" style={styles.subtitle}>
                  {subtitle}
                </T>
              ) : null}
            </View>
            {headerAction ? <View style={styles.headerAction}>{headerAction}</View> : null}
          </View>
          {children}
        </ScrollView>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  safe: { flex: 1 },
  scroll: { padding: space.xl, paddingBottom: 100 },
  scrollWithFooter: { paddingBottom: space.xxl },
  backBtn: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start", paddingRight: space.md, borderRadius: radius.control, marginLeft: -space.xs },
  backPressed: { backgroundColor: color.well },
  header: { flexDirection: "row", alignItems: "flex-start", gap: space.md, marginBottom: space.xl },
  headerText: { flex: 1 },
  headerAction: { paddingTop: space.lg },
  brand: { fontWeight: "700", marginBottom: space.xs },
  subtitle: { marginTop: space.sm },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, gap: space.sm, backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
