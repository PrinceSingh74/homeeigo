import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Clock, Truck, CheckCircle2, XCircle } from "lucide-react-native";
import type { BookingStatus } from "@/lib/store";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { radius, spacing, type } from "@/lib/typography";

const ICONS = {
  clock: Clock,
  truck: Truck,
  check: CheckCircle2,
  x: XCircle,
};

type Props = {
  status: BookingStatus;
  size?: "sm" | "md";
  live?: boolean;
};

export function BookingStatusBadge({ status, size = "md", live }: Props) {
  const cfg = STATUS_CONFIG[status];
  const Icon = ICONS[cfg.icon];
  const sm = size === "sm";

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: cfg.bg, borderColor: cfg.accent + "35" },
        sm && styles.wrapSm,
      ]}
    >
      {live && status === "in_progress" && (
        <View style={[styles.dot, { backgroundColor: cfg.accent }]} />
      )}
      <Icon size={sm ? 12 : 14} color={cfg.accent} strokeWidth={2.5} />
      <Text style={[styles.text, { color: cfg.text }, sm && styles.textSm]}>
        {cfg.shortLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  wrapSm: { paddingHorizontal: 10, paddingVertical: 4 },
  text: { ...type.chipSm, fontWeight: "800", letterSpacing: 0.15 },
  textSm: { fontSize: 10, lineHeight: 12 },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: -1,
  },
});
