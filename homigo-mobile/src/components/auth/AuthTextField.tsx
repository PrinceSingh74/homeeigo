import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { radius, type } from "@/lib/typography";

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  errorMessage?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "words" | "sentences";
  editable?: boolean;
};

export function AuthTextField({
  label,
  value,
  onChangeText,
  errorMessage,
  secureTextEntry,
  keyboardType = "default",
  autoCapitalize = "none",
  editable = true,
}: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        placeholderTextColor={c.textSecondary}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.cardBg,
            borderColor: errorMessage ? "#EF4444" : c.border,
          },
        ]}
      />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { ...type.small, fontWeight: "600", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  error: { color: "#EF4444", fontSize: 13, marginTop: 6 },
});
