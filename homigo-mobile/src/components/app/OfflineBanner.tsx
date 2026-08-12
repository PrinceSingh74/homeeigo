import React from "react";
import { View, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetworkStatus } from "@/hooks/use-network-status";

/** Slim top banner shown only while the device is offline. */
export function OfflineBanner(): React.ReactNode {
  const { online } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  if (online) return null;
  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        paddingTop: insets.top + 6,
        paddingBottom: 8,
        backgroundColor: "#B91C1C",
        alignItems: "center",
        zIndex: 1000,
      }}
    >
      <Text style={{ color: "white", fontSize: 13, fontWeight: "600" }}>No internet connection</Text>
    </View>
  );
}
