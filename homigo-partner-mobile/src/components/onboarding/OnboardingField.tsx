import { StyleSheet, Text, TextInput, View } from "react-native";
import { partnerColors } from "@/theme/colors";

export function OnboardingField(props: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad" | "numeric";
  error?: string;
  accessibilityLabel?: string;
  maxLength?: number;
  editable?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  prefix?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.row}>
        {props.prefix ? <Text style={styles.prefix}>{props.prefix}</Text> : null}
        <TextInput
          accessibilityLabel={props.accessibilityLabel ?? props.label}
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          secureTextEntry={props.secureTextEntry}
          keyboardType={props.keyboardType}
          maxLength={props.maxLength}
          editable={props.editable !== false}
          autoCapitalize={props.autoCapitalize}
          style={[styles.input, props.prefix ? styles.inputFlex : null, props.error ? styles.inputError : null]}
          placeholderTextColor="#94a3b8"
        />
      </View>
      {props.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {props.error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  prefix: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 14,
    paddingHorizontal: 12,
    minHeight: 44,
    textAlignVertical: "center",
    paddingTop: 12,
    backgroundColor: "rgba(255,255,255,0.9)",
    color: partnerColors.textMuted,
    fontWeight: "700",
    fontSize: 13,
  },
  input: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    backgroundColor: "rgba(255,255,255,0.9)",
    color: partnerColors.text,
    flex: 1,
  },
  inputFlex: { flex: 1 },
  inputError: { borderColor: partnerColors.danger },
  error: { color: partnerColors.danger, fontSize: 12 },
});
