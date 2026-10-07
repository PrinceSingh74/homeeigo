import { Tabs } from "expo-router";
import { ClipboardList, Home, LayoutGrid, User, Wallet } from "lucide-react-native";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "@/theme/tokens";

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // The bar clears the home indicator / gesture area instead of sitting on it.
  const bottom = Math.max(insets.bottom, 8);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.leaf,
        tabBarInactiveTintColor: color.mist,
        tabBarStyle: {
          backgroundColor: color.surface,
          borderTopColor: color.line,
          borderTopWidth: StyleSheet.hairlineWidth,
          // Room for a 24-pt icon and a 12-pt label that may be scaled up by the system font size.
          height: 70 + bottom,
          paddingBottom: bottom,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 12, lineHeight: 16, fontWeight: "600", marginBottom: 4 },
        tabBarAllowFontScaling: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color: c }) => <Home color={c} size={24} /> }} />
      {/* Tab names are kept as they were: the device test scripts (e2e/native-android-*) find tabs by these words. */}
      <Tabs.Screen name="requests" options={{ title: "Requests", tabBarIcon: ({ color: c }) => <ClipboardList color={c} size={24} /> }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet", tabBarIcon: ({ color: c }) => <Wallet color={c} size={24} /> }} />
      <Tabs.Screen name="explore" options={{ title: "HQ", tabBarIcon: ({ color: c }) => <LayoutGrid color={c} size={24} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color: c }) => <User color={c} size={24} /> }} />
    </Tabs>
  );
}
