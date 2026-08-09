import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { partnerColors } from "@/theme/colors";

export function KpiCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon?: LucideIcon;
}) {
  return (
    <View style={styles.card}>
      {Icon ? <Icon color={partnerColors.primary} size={20} /> : null}
      <Text style={styles.value}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: "46%",
    backgroundColor: "rgba(255,255,255,0.82)",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
  },
  value: { marginTop: 10, fontSize: 22, fontWeight: "800", color: partnerColors.text },
  label: { marginTop: 4, fontSize: 12, color: partnerColors.textMuted },
});
