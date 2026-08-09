import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";

export default function Index() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: partnerColors.cream }}>
        <ActivityIndicator color={partnerColors.primary} />
      </View>
    );
  }

  if (accessToken) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}
