import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { MapPin, Check, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { LOCATIONS, type LocationId } from "@/lib/services";
import { useAppStore } from "@/lib/store";
import { spacing, radius, type, screenPadding } from "@/lib/typography";
import { sheetHandle, bookingUi } from "@/lib/booking-ui";

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function LocationSheet({ visible, onClose }: Props) {
  const { colors: c } = useTheme();
  const locationId = useAppStore((s) => s.locationId);
  const setLocationId = useAppStore((s) => s.setLocationId);
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>Choose location</Text>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.list}
        >
          {LOCATIONS.map((loc) => {
            const active = loc.id === locationId;
            return (
              <Pressable
                key={loc.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setLocationId(loc.id as LocationId);
                  onClose();
                }}
                style={[
                  styles.row,
                  {
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? c.primary + "12" : c.bg,
                  },
                ]}
              >
                <MapPin size={20} color={active ? c.primary : c.textSecondary} />
                <View style={styles.rowText}>
                  <Text style={[styles.label, { color: c.text }]}>{loc.label}</Text>
                  <Text style={[styles.meta, { color: c.textSecondary }]}>
                    {loc.city} · PIN {loc.pin}
                  </Text>
                </View>
                {active && (
                  <View style={[styles.check, { backgroundColor: c.primary }]}>
                    <Check size={14} color="#fff" strokeWidth={3} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    paddingHorizontal: screenPadding,
    paddingBottom: spacing["3xl"],
    maxHeight: "72%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  title: { ...type.title, fontSize: 20 },
  list: { paddingBottom: spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1 },
  label: { ...type.bodyBold },
  meta: { ...type.caption, marginTop: 2 },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
});
