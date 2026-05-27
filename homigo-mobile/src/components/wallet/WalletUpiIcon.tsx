import React from "react";
import { View, Text, StyleSheet } from "react-native";

/** UPI mark — reference uses UPI logo style */
export function WalletUpiIcon() {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>UPI</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 36,
    height: 22,
    borderRadius: 4,
    backgroundColor: "#06B6D4",
    alignItems: "center",
    justifyContent: "center",
  },
  text: { color: "#fff", fontSize: 9, fontWeight: "900", letterSpacing: 0.3 },
});
