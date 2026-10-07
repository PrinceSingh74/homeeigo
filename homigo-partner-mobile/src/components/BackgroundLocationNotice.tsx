import { useEffect, useState } from "react";
import { Alert, Linking, Platform } from "react-native";
import { Banner, Button, T } from "@/components/ui";
import { refreshBackgroundPermission, requestBackgroundLocationPermission, useBackgroundLocationStatus } from "@/lib/background-location";

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
                  Alert.alert("Background location is off", "You can turn it on any time in Settings → Location → \"Allow all the time\".", [
                    { text: "Later", style: "cancel" },
                    { text: "Open Settings", onPress: () => void Linking.openSettings() },
                  ]);
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
      <Banner
        tone="warning"
        testID="background-location-unavailable"
        message="Background location isn't available in this app build. Keep the app open while you're online — once it's closed you stop sharing location and new jobs may not reach you."
      />
    );
  }

  if (permission === "granted") {
    if (error) return <Banner tone="warning" testID="background-location-error" message={`Background location could not start: ${error}`} />;
    return running ? (
      <T kind="small" testID="background-location-running">
        Location is shared while the app runs in the background. Your phone's battery saver can still pause it — keep HOMEEIGO Partner out of battery restrictions.
      </T>
    ) : null;
  }

  return (
    <Banner
      tone="warning"
      testID="background-location-needed"
      message="When the app is in the background you stop sharing location, and dispatch will see you as stale — new jobs may not reach you."
      action={<Button label="Allow background location" variant="secondary" onPress={ask} loading={asking} testID="background-location-allow" />}
    />
  );
}
