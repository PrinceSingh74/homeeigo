import type { LucideIcon } from "lucide-react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { T } from "@/components/ui";
import { color, elevation, radius, space, touch, type Tone } from "@/theme/tokens";

/**
 * A titled section of the job screen that opens and closes. New primitive for the job flow (the ui
 * kit has `Section`, which is always open): the heading is a 48-pt button that says whether the
 * section is expanded, and the body is mounted only while it is open — a closed panel asks the
 * server for nothing.
 *
 * `summary` is the one line that stays readable while it is closed (a count, a state), so a closed
 * section still says whether it needs attention.
 */
export function Collapsible({
  title,
  summary,
  summaryTone,
  icon: Icon,
  defaultOpen = false,
  open: controlled,
  onToggle,
  children,
  testID,
  toggleTestID,
}: {
  title: string;
  summary?: string | null;
  summaryTone?: Tone;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  /** Controlled mode: pass with `onToggle`. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
  testID?: string;
  toggleTestID?: string;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = controlled ?? own;
  const everOpen = useRef(open);
  if (open) everOpen.current = true;
  const opened = everOpen.current;
  const Chevron = open ? ChevronUp : ChevronDown;
  return (
    <View testID={testID} style={styles.card}>
      <Pressable
        testID={toggleTestID}
        onPress={() => {
          setOwn(!open);
          onToggle?.(!open);
        }}
        accessibilityRole="button"
        accessibilityLabel={summary ? `${title}. ${summary}` : title}
        accessibilityState={{ expanded: open }}
        accessibilityHint={open ? "Closes this section" : "Opens this section"}
        style={({ pressed }) => [styles.head, pressed ? styles.headPressed : null]}
      >
        {Icon ? <Icon color={color.leaf} size={20} /> : null}
        <View style={styles.headText}>
          <T kind="heading">{title}</T>
          {summary ? (
            <T kind="small" tone={summaryTone ?? "slate"}>
              {summary}
            </T>
          ) : null}
        </View>
        <Chevron color={color.slate} size={20} />
      </Pressable>
      {/* Once opened the body stays mounted (hidden when closed), so a note typed inside a section
          is not lost by closing it. Nothing is mounted — and nothing fetched — before the first open. */}
      {opened ? <View style={[styles.body, open ? null : styles.hidden]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, overflow: "hidden", ...elevation.card },
  head: { minHeight: touch.min + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  headPressed: { backgroundColor: color.well },
  headText: { flex: 1, gap: 2 },
  hidden: { display: "none" },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.md },
});
