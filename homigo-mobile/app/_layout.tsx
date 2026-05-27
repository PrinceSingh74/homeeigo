import "../global.css";
import React from "react";
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useTheme } from "@/hooks/useTheme";
import { AppToast } from "@/components/AppToast";
import { AppOverlays } from "@/components/app/AppOverlays";

export default function RootLayout() {
  const { colors: themeColors, isDark } = useTheme();

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: themeColors.bg },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="book"
            options={{
              animation: "slide_from_right",
              presentation: "card",
            }}
          />
        </Stack>
        <AppToast />
        <AppOverlays />
        <StatusBar style={isDark ? "light" : "dark"} />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
