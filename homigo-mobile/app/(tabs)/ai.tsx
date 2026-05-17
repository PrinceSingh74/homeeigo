import React from "react";
import { View, Text, StyleSheet, SafeAreaView } from "react-native";
import { useTheme } from "@/hooks/useTheme";

export default function AIScreen() {
  const { colors: themeColors } = useTheme();

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: themeColors.bg },
      ]}
    >
      <View style={styles.content}>
        <Text style={{ color: themeColors.text, fontSize: 24, fontWeight: "bold" }}>
          AI Assistant
        </Text>
        <Text style={{ color: themeColors.textSecondary, marginTop: 8 }}>
          Coming soon...
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    flex: 1,
    justifyContent: "center",
  },
});
