import React from "react";
import { Tabs } from "expo-router";
import { BottomNav } from "@/components/BottomNav";

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <BottomNav {...props} />}
      screenOptions={{
        headerShown: false,
        // A visited tab stays mounted, so without this every hero pulse, particle
        // field and shimmer on all six tabs keeps animating and re-rendering while
        // the user looks at one of them. Freezing suspends the off-screen trees;
        // state and scroll position survive, so nothing is re-fetched on return.
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="services" options={{ title: "Services" }} />
      <Tabs.Screen name="bookings" options={{ title: "Bookings" }} />
      <Tabs.Screen name="ai" options={{ title: "AI Assistant" }} />
      <Tabs.Screen name="wallet" options={{ title: "Wallet" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}
