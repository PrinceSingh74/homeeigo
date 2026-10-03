import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { AlertCircle, WifiOff } from "lucide-react-native";
import { useNetInfo } from "@react-native-community/netinfo";
import { useAiTheme, aiSpacing, aiType } from "@/lib/ai-mobile-theme";

export function AiOfflineIndicator() {
  const netInfo = useNetInfo();
  const [isOffline, setIsOffline] = useState(false);
  const { c } = useAiTheme();

  useEffect(() => {
    const offline =
      netInfo.isConnected === false || netInfo.isConnected === null;
    setIsOffline(offline);
  }, [netInfo.isConnected]);

  if (!isOffline) return null;

  return (
    <View style={[styles.banner, { backgroundColor: "rgba(239, 68, 68, 0.1)", borderColor: "#EF4444" }]}>
      <WifiOff size={16} color="#EF4444" strokeWidth={2} />
      <Text style={[styles.text, { color: "#DC2626" }]}>
        You're offline. Messages will send when you reconnect.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: aiSpacing.gapSm,
    paddingHorizontal: aiSpacing.gap,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: aiSpacing.screen,
    marginVertical: aiSpacing.gapSm,
  },
  text: {
    ...aiType.caption,
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
});
