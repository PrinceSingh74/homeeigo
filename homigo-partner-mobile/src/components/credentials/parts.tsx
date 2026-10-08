import { ChevronRight, CloudOff, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Banner, Button, Card, EmptyState, Pill, T } from "@/components/ui";
import { color, radius, space, touch } from "@/theme/tokens";

/**
 * The pieces "My credentials" and "My services" share: a titled group, a row whose state is a word in
 * a pill, a list of radio rows for a long choice, and the load-failure states.
 */

type PillTone = "neutral" | "success" | "warning" | "danger" | "info";
export type PillView = { label: string; tone: PillTone; testID?: string };
export type Notice = { tone: "success" | "info" | "warning" | "danger"; message: string };

/** A titled group of rows on one card. The title is a real heading; an empty group says what will appear. */
export function Group({ title, empty, isEmpty, caption, testID, children }: { title: string; empty: string; isEmpty: boolean; caption?: string; testID?: string; children: ReactNode }) {
  return (
    <View style={styles.group} testID={testID}>
      <T kind="heading" accessibilityRole="header">
        {title}
      </T>
      {caption ? <T kind="small">{caption}</T> : null}
      <Card>{isEmpty ? <T kind="small">{empty}</T> : children}</Card>
    </View>
  );
}

function RowText({ title, pills, subtitle }: { title: string; pills: ReadonlyArray<PillView | null | undefined>; subtitle?: string | null }) {
  const shown = pills.filter((p): p is PillView => Boolean(p));
  return (
    <View style={styles.rowText}>
      <T kind="bodyStrong">{title}</T>
      {shown.length ? (
        <View style={styles.pills}>
          {shown.map((p) => (
            <Pill key={p.label} label={p.label} tone={p.tone} testID={p.testID} />
          ))}
        </View>
      ) : null}
      {subtitle ? <T kind="small">{subtitle}</T> : null}
    </View>
  );
}

/** What a screen reader says for a row: its name, its state in words, then the detail. */
export function rowLabel(title: string, pills: ReadonlyArray<PillView | null | undefined>, subtitle?: string | null): string {
  return [title, ...pills.filter((p): p is PillView => Boolean(p)).map((p) => p.label), subtitle].filter(Boolean).join(". ");
}

/**
 * One row of a list. With `onPress` the whole row is a button that opens its details; without it the
 * row is plain content, and `children` (lines, actions) sit under it and stay reachable one by one.
 */
export function StatusRow({
  title,
  pills,
  subtitle,
  onPress,
  last = false,
  testID,
  children,
}: {
  title: string;
  pills: ReadonlyArray<PillView | null | undefined>;
  subtitle?: string | null;
  onPress?: () => void;
  last?: boolean;
  testID?: string;
  children?: ReactNode;
}) {
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={rowLabel(title, pills, subtitle)}
        accessibilityHint="Opens the details"
        style={({ pressed }) => [styles.row, last ? null : styles.rowLine, pressed ? styles.pressed : null]}
      >
        <RowText title={title} pills={pills} subtitle={subtitle} />
        <ChevronRight color={color.mist} size={18} />
      </Pressable>
    );
  }
  return (
    <View testID={testID} style={[styles.block, last ? null : styles.rowLine]}>
      <View accessible accessibilityLabel={rowLabel(title, pills, subtitle)}>
        <RowText title={title} pills={pills} subtitle={subtitle} />
      </View>
      {children}
    </View>
  );
}

export type RadioOption<T extends string> = { id: T; label: string; detail?: string | null; testID?: string };

/** One choice from a list that is too long, or too wordy, for chips. Each row is a 48-pt radio. */
export function RadioRows<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  testID,
}: {
  /** Names the group for a screen reader. */
  label: string;
  options: ReadonlyArray<RadioOption<T>>;
  value: T | null;
  onChange: (id: T) => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID} style={styles.radios}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <Pressable
            key={o.id}
            testID={o.testID}
            onPress={() => onChange(o.id)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={o.detail ? `${o.label}, ${o.detail}` : o.label}
            accessibilityState={{ checked: selected, disabled }}
            style={({ pressed }) => [styles.radio, selected ? styles.radioOn : null, pressed ? styles.pressed : null, disabled ? styles.off : null]}
          >
            <View style={[styles.dot, selected ? styles.dotOn : null]}>{selected ? <View style={styles.dotFill} /> : null}</View>
            <View style={styles.radioText}>
              <T kind="bodyStrong">{o.label}</T>
              {o.detail ? <T kind="small">{o.detail}</T> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The visible label of a group of choices inside a form. */
export function FormLabel({ children }: { children: string }) {
  return (
    <T kind="smallStrong" tone="slate">
      {children}
    </T>
  );
}

/**
 * A read that failed with nothing to show. No connection and a refusal are different sentences; the
 * refusal's sentence is passed in already worded (these routes answer with bare codes).
 */
export function LoadFailure({ title, failure, onRetry, testID }: { title: string; failure: Notice; onRetry: () => void; testID?: string }) {
  const offline = failure.tone === "warning";
  return (
    <Card testID={testID}>
      <View accessible accessibilityRole="alert">
        <EmptyState icon={offline ? WifiOff : CloudOff} title={offline ? "You're offline" : title} message={offline ? "Check your connection and try again." : failure.message} />
      </View>
      <Button label="Try again" variant="secondary" onPress={onRetry} />
    </Card>
  );
}

/** A refresh failed while earlier data is on screen: the data stays and this says it may be out of date. */
export function StaleBanner({ failure, onRetry }: { failure: Notice; onRetry: () => void }) {
  return <Banner tone="warning" title="Could not refresh" message={`${failure.message} Showing what was loaded earlier.`} action={<Button label="Try again" variant="secondary" onPress={onRetry} />} />;
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  row: { minHeight: touch.min + space.sm, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  block: { paddingVertical: space.md, gap: space.sm },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowText: { flex: 1, gap: space.xs },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.xs },
  pressed: { backgroundColor: color.well },
  off: { opacity: 0.5 },

  radios: { gap: space.sm },
  radio: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  radioOn: { borderColor: color.leaf, backgroundColor: color.leafWash },
  radioText: { flex: 1, gap: space.xs / 2 },
  dot: { width: space.xl, height: space.xl, borderRadius: radius.pill, borderWidth: 2, borderColor: color.mist, alignItems: "center", justifyContent: "center" },
  dotOn: { borderColor: color.leaf },
  dotFill: { width: space.sm + 2, height: space.sm + 2, borderRadius: radius.pill, backgroundColor: color.leaf },
});
