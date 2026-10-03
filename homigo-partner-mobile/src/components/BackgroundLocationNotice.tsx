import { useEffect, useState } from "react";
import { Alert, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import {
  refreshBackgroundPermission,
  requestBackgroundLocationPermission,
  useBackgroundLocationStatus,
} from "@/lib/background-location";
import { partnerColors } from "@/theme/colors";

/**
 * Tells an online partner the truth about background visibility, and lets them fix it.
 *
 * The OS decides background delivery, so even the "granted" line promises no more than the app can
 * do: location is shared while the app is running in the background, and the phone may still pause
 * it. Without permission the partner is told plainly that they go stale once the app is closed.
 */
export function BackgroundLocationNotice() {
  const { permission, running, error } = useBackgroundLocationStatus();
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    void refreshBackgroundPermission();
  }, []);

  function ask() {
    Alert.alert(
      "Stay visible in the background",
      "While you are online or on a job, HOMEEIGO Partner shares your location in the background so nearby jobs can reach you and customers see you arriving. It stops when you go offline and finish your jobs.\n\nOn the next screen choose \"Allow all the time\" (Android) or \"Always\" (iPhone).",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Continue",
          onPress: () => {
            setAsking(true);
            void requestBackgroundLocationPermission()
              .then((p) => {
                if (p === "denied") {
                  Alert.alert(
                    "Background location is off",
                    "You can turn it on any time in Settings → Location → \"Allow all the time\".",
                    [
                      { text: "Later", style: "cancel" },
                      { text: "Open Settings", onPress: () => void Linking.openSettings() },
                    ],
                  );
                }
              })
              .finally(() => setAsking(false));
          },
        },
      ],
    );
  }

  // The Expo web export (used for e2e) has no background execution model to report on.
  if (Platform.OS === "web") return null;

  if (permission === "unavailable") {
    return (
      <Text style={styles.warn}>
        Background location isn't available in this app build. Keep the app open while you're online —
        once it's closed you stop sharing location and new jobs may not reach you.
      </Text>
    );
  }

  if (permission === "granted") {
    if (error) return <Text style={styles.warn}>Background location could not start: {error}</Text>;
    return running ? (
      <Text style={styles.muted}>
        Location is shared while the app runs in the background. Your phone's battery saver can still
        pause it — keep HOMEEIGO Partner out of battery restrictions.
      </Text>
    ) : null;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.warn}>
        When the app is in the background you stop sharing location, and dispatch will see you as
        stale — new jobs may not reach you.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={asking}
        onPress={ask}
        style={[styles.btn, asking && styles.btnDisabled]}
      >
        <Text style={styles.btnText}>{asking ? "Requesting…" : "Allow background location"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, gap: 6 },
  warn: { marginTop: 8, color: partnerColors.warning, fontSize: 12, lineHeight: 17 },
  muted: { marginTop: 8, color: partnerColors.textMuted, fontSize: 12, lineHeight: 17 },
  btn: {
    borderWidth: 1,
    borderColor: partnerColors.primary,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: partnerColors.primary, fontWeight: "700", fontSize: 13 },
});
