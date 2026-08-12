import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { radius, type } from "@/lib/typography";

type Props = {
  value: string;
  onChange: (value: string) => void;
  errorMessage?: string;
  disabled?: boolean;
};

export function PhoneField({ value, onChange, errorMessage, disabled }: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: c.text }]}>Mobile number</Text>
      <View style={styles.row}>
        <View style={[styles.prefix, { borderColor: c.border, backgroundColor: c.cardBg }]}>
          <Text style={{ color: c.textSecondary, fontWeight: "600" }}>+91</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 10))}
          keyboardType="phone-pad"
          editable={!disabled}
          placeholder="98765 43210"
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
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { ...type.small, fontWeight: "600", marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  prefix: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    justifyContent: "center",
    minHeight: 48,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    minHeight: 48,
  },
  error: { color: "#EF4444", fontSize: 13, marginTop: 6 },
});
