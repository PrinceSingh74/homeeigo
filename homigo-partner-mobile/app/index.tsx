import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { T } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { color, space } from "@/theme/tokens";

export default function Index() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const accessToken = useAuthStore((s) => s.accessToken);

  if (!hydrated) {
    return (
      <View style={styles.root} accessible accessibilityRole="progressbar" accessibilityLabel="Opening HOMEEIGO Partner">
        <ActivityIndicator color={color.leaf} size="large" />
        <T kind="small">Opening HOMEEIGO Partner…</T>
      </View>
    );
  }

  if (accessToken) return <Redirect href="/(tabs)" />;
  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, backgroundColor: color.paper },
});
