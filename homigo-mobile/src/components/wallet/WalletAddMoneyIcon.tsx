import React from "react";
import { View, StyleSheet } from "react-native";
import { Wallet, Plus } from "lucide-react-native";

/** Purple wallet + plus — matches reference quick-action icon */
export function WalletAddMoneyIcon({ size = 22, color = "#7C3AED" }: { size?: number; color?: string }) {
  return (
    <View style={[styles.wrap, { width: size + 4, height: size + 4 }]}>
      <Wallet size={size} color={color} strokeWidth={2} />
      <View style={[styles.plusBadge, { backgroundColor: color }]}>
        <Plus size={8} color="#fff" strokeWidth={3} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  plusBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "#fff",
  },
});
