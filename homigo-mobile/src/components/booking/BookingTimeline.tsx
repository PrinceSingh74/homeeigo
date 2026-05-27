import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Check } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import type { TimelineEvent } from "@/lib/store";
import { spacing, type as typo } from "@/lib/typography";

type Props = {
  events: TimelineEvent[];
  compact?: boolean;
};

export function BookingTimeline({ events, compact }: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={styles.wrap}>
      {events.map((ev, i) => {
        const last = i === events.length - 1;
        return (
          <View key={ev.id} style={styles.row}>
            <View style={styles.rail}>
              <View
                style={[
                  styles.dot,
                  ev.done
                    ? { backgroundColor: c.success, borderColor: c.success }
                    : { backgroundColor: c.cardBg, borderColor: c.border },
                ]}
              >
                {ev.done && <Check size={10} color="#fff" strokeWidth={3} />}
              </View>
              {!last && (
                <View
                  style={[
                    styles.line,
                    {
                      backgroundColor: ev.done ? c.success : c.border,
                    },
                  ]}
                />
              )}
            </View>
            <View style={[styles.content, compact && { paddingBottom: spacing.sm }]}>
              <Text
                style={[
                  styles.label,
                  { color: ev.done ? c.text : c.textSecondary },
                  !ev.done && { fontWeight: "500" },
                ]}
              >
                {ev.label}
              </Text>
              {ev.at ? (
                <Text style={[styles.time, { color: c.textSecondary }]}>
                  {formatTime(ev.at)}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.xs },
  row: { flexDirection: "row", minHeight: 44 },
  rail: { width: 28, alignItems: "center" },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  line: {
    width: 2,
    flex: 1,
    marginVertical: 2,
    borderRadius: 1,
  },
  content: { flex: 1, paddingBottom: spacing.md, paddingTop: 2 },
  label: { ...typo.bodyBold, fontSize: 14 },
  time: { ...typo.caption, marginTop: 2 },
});
