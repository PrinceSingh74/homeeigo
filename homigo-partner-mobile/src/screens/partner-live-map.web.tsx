import { MapPin } from "lucide-react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { EmptyState } from "@/components/ui";

/**
 * The web build of the live map. `react-native-maps` is a native module and cannot be bundled for
 * the web (the web export exists for the screen walk in e2e/web-screens.verify.cjs and the
 * Playwright run, not for partners), so this build says so instead of failing the whole bundle.
 * The real screen is `partner-live-map.tsx`.
 */
export function PartnerLiveMapScreen() {
  return (
    <PartnerScreen title="Live map" showBack>
      <EmptyState testID="live-map-unavailable" icon={MapPin} title="The live map is in the mobile app" message="Open the HOMEEIGO Partner app on your phone to see your jobs on the map." />
    </PartnerScreen>
  );
}
