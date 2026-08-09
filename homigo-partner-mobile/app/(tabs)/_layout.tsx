import { Tabs } from "expo-router";
import { ClipboardList, LayoutGrid, User, Wallet, Home } from "lucide-react-native";
import { partnerColors } from "@/theme/colors";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: partnerColors.primary,
        tabBarInactiveTintColor: partnerColors.textMuted,
        tabBarStyle: {
          backgroundColor: "rgba(255,255,255,0.95)",
          borderTopColor: partnerColors.line,
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color }) => <Home color={color} size={22} /> }} />
      <Tabs.Screen name="requests" options={{ title: "Requests", tabBarIcon: ({ color }) => <ClipboardList color={color} size={22} /> }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet", tabBarIcon: ({ color }) => <Wallet color={color} size={22} /> }} />
      <Tabs.Screen name="explore" options={{ title: "HQ", tabBarIcon: ({ color }) => <LayoutGrid color={color} size={22} /> }} />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: ({ color }) => <User color={color} size={22} /> }} />
    </Tabs>
  );
}
