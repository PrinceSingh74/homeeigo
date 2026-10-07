import { WifiOff } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "@/components/ui";
import { useIsOffline, useRetryConnection } from "@/hooks/account/use-connectivity";
import { color, space, touch } from "@/theme/tokens";

/**
 * Shown above every screen while the app's requests are getting no answer (see
 * `hooks/account/use-connectivity`). It takes its own space at the top instead of covering the
 * screen, clears by itself when a request is answered, and can be tapped to ask again now.
 */
export function OfflineBanner() {
  const offline = useIsOffline();
  const retry = useRetryConnection();
  const insets = useSafeAreaInsets();
  if (!offline) return null;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]} testID="offline-banner">
      <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="You're offline. What you see may be out of date. Try again" style={({ pressed }) => [styles.bar, pressed ? styles.pressed : null]}>
        <WifiOff color={color.marigold} size={18} />
        <View style={styles.text} accessibilityLiveRegion="polite">
          <T kind="smallStrong">You're offline</T>
          <T kind="caption" tone="slate">
            What you see may be out of date.
          </T>
        </View>
        <T kind="smallStrong" tone="leaf">
          Try again
        </T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: color.marigoldWash, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  bar: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.xs },
  pressed: { opacity: 0.7 },
  text: { flex: 1 },
});
