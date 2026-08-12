import React, { useRef } from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { radius } from "@/lib/typography";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export function OtpInput({ value, onChange, disabled }: Props) {
  const { colors: c } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const digits = value.padEnd(6, " ").slice(0, 6).split("");

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {digits.map((digit, index) => (
          <View
            key={index}
            style={[
              styles.box,
              {
                borderColor: c.border,
                backgroundColor: c.cardBg,
              },
            ]}
          >
            <TextInput
              ref={index === 0 ? inputRef : undefined}
              value={digit.trim()}
              editable={false}
              style={[styles.digit, { color: c.text }]}
            />
          </View>
        ))}
      </View>
      <TextInput
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        editable={!disabled}
        maxLength={6}
        style={styles.hidden}
        autoFocus
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "relative" },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  box: {
    flex: 1,
    aspectRatio: 0.85,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  hidden: {
    position: "absolute",
    opacity: 0,
    width: 1,
    height: 1,
  },
});
