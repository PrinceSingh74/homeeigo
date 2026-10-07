import type { LucideIcon } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { T } from "@/components/ui";
import { color, elevation, radius, space } from "@/theme/tokens";

/** One number the partner checks at a glance, with what it counts underneath. */
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
    <View style={styles.card} accessible accessibilityLabel={`${label}: ${value}`}>
      {Icon ? (
        <View style={styles.icon}>
          <Icon color={color.leaf} size={18} />
        </View>
      ) : null}
      <T kind="title" numeric style={styles.value}>
        {value}
      </T>
      <T kind="small">{label}</T>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: "46%", backgroundColor: color.surface, borderRadius: radius.card, padding: space.lg, borderWidth: 1, borderColor: color.line, ...elevation.card },
  icon: { width: 32, height: 32, borderRadius: radius.control, backgroundColor: color.leafWash, alignItems: "center", justifyContent: "center" },
  value: { marginTop: space.md },
});
