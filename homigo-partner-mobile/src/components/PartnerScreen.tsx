import { router, useSegments } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, type ComponentRef, type ReactNode } from "react";
import { Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ScreenScrollContext, type RevealInScroll } from "@/components/screen-scroll";
import { KeyboardAvoider, T } from "@/components/ui";
import { revealScrollDelta } from "@/lib/keyboard-reveal";
import { color, radius, space, touch } from "@/theme/tokens";

/** The native "bring the focused input into view" runs on the keyboard event; measure after it. */
const REVEAL_SETTLE_MS = 80;

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
  // On a tab the tab bar already clears the gesture area: adding the bottom inset again left a strip
  // of paper between the docked footer and the tab bar.
  const onTab = useSegments()[0] === "(tabs)";

  // A field low on the page asks, on focus, for itself AND the control under it to be visible once
  // the keyboard is up. The OS scrolls the field into view on its own; the Confirm button under it
  // was left behind the docked footer (Android emulator, 2026-10-08). The request waits for the
  // keyboard's own event, then measures and scrolls by the overlap (`revealScrollDelta`).
  // Typed through ComponentRef: a ScrollView generic in angle brackets here would be what the
  // keyboard-taps unit test reads as the rendered element.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const footerRef = useRef<View>(null);
  const offsetY = useRef(0);
  const keyboardTop = useRef<number | null>(null);
  const pending = useRef<{ node: View; allowanceBelow: number } | null>(null);
  const runReveal = useCallback((node: View, allowanceBelow: number) => {
    const scroll = scrollRef.current;
    const top = keyboardTop.current;
    if (!scroll || top === null) return;
    const measureFooter = (next: (footerHeight: number) => void) => {
      const f = footerRef.current;
      if (!f) return next(0);
      f.measure((_x, _y, _w, h) => next(h));
    };
    measureFooter((footerHeight) => {
      // `measure` (page coordinates), as the keyboard avoider does: `measureInWindow` is counted from
      // under the status bar on Android, which puts every edge one status bar too high.
      (scroll as unknown as View).measure((_sx, _sy, _sw, _sh, _spx, scrollPageY) => {
        node.measure((_x, _y, _w, h, _px, pageY) => {
          const delta = revealScrollDelta({ viewTop: pageY, viewBottom: pageY + h, allowanceBelow, visibleTop: scrollPageY, visibleBottom: top - footerHeight });
          if (delta > 0) scroll.scrollTo({ y: offsetY.current + delta, animated: true });
        });
      });
    });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const y = e?.endCoordinates?.screenY;
      keyboardTop.current = typeof y === "number" && Number.isFinite(y) ? y : null;
      const ask = pending.current;
      pending.current = null;
      if (ask) setTimeout(() => runReveal(ask.node, ask.allowanceBelow), REVEAL_SETTLE_MS);
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTop.current = null;
      pending.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [runReveal]);
  const reveal = useCallback<RevealInScroll>(
    (node, allowanceBelow) => {
      if (!node) return;
      if (keyboardTop.current === null) pending.current = { node, allowanceBelow };
      else setTimeout(() => runReveal(node, allowanceBelow), REVEAL_SETTLE_MS);
    },
    [runReveal],
  );
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetY.current = e.nativeEvent.contentOffset.y;
  }, []);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={footer && !onTab ? ["top", "bottom"] : ["top"]}>
        {/* Pads by the keyboard's real overlap (nothing where the window already resized), so a field low on the page and the docked footer stay above it. */}
        <KeyboardAvoider style={styles.safe}>
        <ScreenScrollContext.Provider value={reveal}>
        {/* "handled": a tap on a button while the keyboard is open reaches the button (X-69) instead of only dismissing the keyboard. */}
        <ScrollView
          ref={scrollRef}
          onScroll={onScroll}
          scrollEventThrottle={32}
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
        {footer ? (
          <View ref={footerRef} collapsable={false} style={styles.footer}>
            {footer}
          </View>
        ) : null}
        </ScreenScrollContext.Provider>
        </KeyboardAvoider>
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
  subtitle: { marginTop: space.sm },
  footer: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, gap: space.sm, backgroundColor: color.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
