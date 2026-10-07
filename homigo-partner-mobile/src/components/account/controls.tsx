import type { LucideIcon } from "lucide-react-native";
import { Check } from "lucide-react-native";
import { useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, TextInput, View } from "react-native";
import { T } from "@/components/ui";
import { color, radius, space, tone, touch, type, type Tone } from "@/theme/tokens";

/**
 * Small controls the account, home and jobs screens share. Each is at least 48 pt tall, names
 * itself to a screen reader and reports its state.
 */

export type Segment<T extends string> = { id: T; label: string; accessibilityLabel?: string; count?: number | null };

/**
 * One choice of a few, all visible: a filter row. The selected segment is filled; the whole row is a
 * tab list to a screen reader.
 */
export function Segmented<T extends string>({ segments, value, onChange, testID }: { segments: ReadonlyArray<Segment<T>>; value: T; onChange: (id: T) => void; testID?: string }) {
  return (
    <View style={styles.segments} accessibilityRole="tablist" testID={testID}>
      {segments.map((s) => {
        const selected = s.id === value;
        const name = s.accessibilityLabel ?? s.label;
        return (
          <Pressable
            key={s.id}
            testID={testID ? `${testID}-${s.id}` : undefined}
            onPress={() => onChange(s.id)}
            accessibilityRole="tab"
            accessibilityLabel={typeof s.count === "number" ? `${name}, ${s.count}` : name}
            accessibilityState={{ selected }}
            style={({ pressed }) => [styles.segment, selected ? styles.segmentOn : null, pressed && !selected ? styles.pressed : null]}
          >
            <T kind="smallStrong" tone={selected ? "onLeaf" : "slate"} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {s.label}
            </T>
            {typeof s.count === "number" && s.count > 0 ? (
              <View style={[styles.count, selected ? styles.countOn : null]}>
                <T kind="caption" numeric tone={selected ? "leaf" : "slate"} style={styles.countText}>
                  {s.count > 99 ? "99+" : String(s.count)}
                </T>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Choices that wrap: pick one (or several with `multiple`). Each chip is a 48-pt target. */
export function Chips<T extends string>({
  options,
  value,
  onToggle,
  multiple = false,
  disabled = false,
  label,
  testID,
}: {
  options: ReadonlyArray<{ id: T; label: string; accessibilityLabel?: string }>;
  /** The selected id(s). */
  value: ReadonlyArray<T>;
  onToggle: (id: T) => void;
  multiple?: boolean;
  disabled?: boolean;
  /** Names the group for a screen reader. */
  label: string;
  testID?: string;
}) {
  return (
    <View style={styles.chips} accessibilityRole={multiple ? undefined : "radiogroup"} accessibilityLabel={label} testID={testID}>
      {options.map((o) => {
        const selected = value.includes(o.id);
        return (
          <Pressable
            key={o.id}
            testID={testID ? `${testID}-${o.id}` : undefined}
            onPress={() => onToggle(o.id)}
            disabled={disabled}
            accessibilityRole={multiple ? "checkbox" : "radio"}
            accessibilityLabel={o.accessibilityLabel ?? o.label}
            // Checkboxes and radio buttons both report `checked` (TalkBack: "checked" / "not checked").
            accessibilityState={{ checked: selected, disabled }}
            style={({ pressed }) => [styles.chip, selected ? styles.chipOn : null, pressed ? styles.pressed : null, disabled ? styles.off : null]}
          >
            {selected ? <Check color={color.leaf} size={16} /> : null}
            <T kind="smallStrong" tone={selected ? "leaf" : "ink"}>
              {o.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A labelled switch on one 56-pt row. The whole row toggles it. */
export function SwitchRow({
  label,
  help,
  value,
  onChange,
  disabled = false,
  busy = false,
  testID,
}: {
  label: string;
  help?: string | null;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      testID={testID}
      onPress={() => onChange(!value)}
      disabled={off}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={help ?? undefined}
      accessibilityState={{ checked: value, disabled: off, busy }}
      style={({ pressed }) => [styles.switchRow, pressed ? styles.pressed : null]}
    >
      <View style={styles.switchText}>
        <T kind="bodyStrong" tone={disabled ? "mist" : "ink"}>
          {label}
        </T>
        {help ? <T kind="small">{help}</T> : null}
      </View>
      {busy ? <ActivityIndicator color={color.leaf} /> : null}
      {/* The row is the control; the native switch only draws the state. */}
      <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <Switch value={value} disabled={off} trackColor={{ false: color.line, true: color.leaf }} thumbColor={color.surface} ios_backgroundColor={color.line} />
      </View>
    </Pressable>
  );
}

/**
 * A labelled input whose LABEL also focuses it — for forms a thumb (or a device test that taps the
 * first thing named "Full name") reaches by the label. Same look as the kit's `Field`.
 */
export function TapField({
  label,
  value,
  onChangeText,
  help,
  error,
  testID,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  help?: string;
  error?: string | null;
  testID?: string;
} & Omit<React.ComponentProps<typeof TextInput>, "value" | "onChangeText" | "style">) {
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Pressable onPress={() => ref.current?.focus()} accessible={false} style={styles.fieldLabel}>
        <T kind="smallStrong" tone="slate">
          {label}
        </T>
      </Pressable>
      <View style={[styles.fieldBox, focused ? styles.fieldFocused : null, error ? styles.fieldError : null]}>
        <TextInput
          {...input}
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={label}
          accessibilityHint={error ?? help}
          placeholderTextColor={color.mist}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.fieldInput}
        />
      </View>
      {error ? (
        <T kind="small" tone="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : help ? (
        <T kind="small">{help}</T>
      ) : null}
    </View>
  );
}

/** An icon-only button with a real name and a 48-pt target. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  tone: buttonTone = "leaf",
  disabled = false,
  busy = false,
  badge,
  testID,
}: {
  icon: LucideIcon;
  /** What it does — read by a screen reader, since there is no visible text. */
  label: string;
  onPress: () => void;
  tone?: Tone;
  disabled?: boolean;
  busy?: boolean;
  /** A count on the corner (unread). */
  badge?: number | null;
  testID?: string;
}) {
  const off = disabled || busy;
  const t = tone[buttonTone];
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={typeof badge === "number" && badge > 0 ? `${label}, ${badge} unread` : label}
      accessibilityState={{ disabled: off, busy }}
      hitSlop={4}
      style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? color.well : t.bg, borderColor: t.border }, off ? styles.off : null]}
    >
      {busy ? <ActivityIndicator color={t.fg} /> : <Icon color={t.fg} size={20} />}
      {typeof badge === "number" && badge > 0 ? (
        <View style={styles.badge}>
          <T kind="caption" numeric tone="onLeaf" style={styles.badgeText}>
            {badge > 99 ? "99+" : String(badge)}
          </T>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { backgroundColor: color.well },
  off: { opacity: 0.5 },

  segments: { flexDirection: "row", gap: space.xs, padding: space.xs, backgroundColor: color.well, borderRadius: radius.control + space.xs, borderWidth: 1, borderColor: color.line },
  segment: { flex: 1, minHeight: touch.min, borderRadius: radius.control, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: space.xs, paddingHorizontal: space.xs },
  segmentOn: { backgroundColor: color.leaf },
  count: { minWidth: 20, paddingHorizontal: 5, height: 20, borderRadius: radius.pill, backgroundColor: color.surface, alignItems: "center", justifyContent: "center" },
  countOn: { backgroundColor: color.onLeaf },
  countText: { fontWeight: "700" },

  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: touch.min, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, flexDirection: "row", alignItems: "center", gap: space.xs },
  chipOn: { backgroundColor: color.leafWash, borderColor: color.leaf },

  switchRow: { minHeight: touch.min + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  switchText: { flex: 1, gap: 2 },

  field: { gap: 2 },
  fieldLabel: { minHeight: 28, justifyContent: "center" },
  fieldBox: { minHeight: touch.min + 4, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: color.line, borderRadius: radius.control, backgroundColor: color.surface, paddingHorizontal: space.lg },
  fieldFocused: { borderColor: color.leaf, borderWidth: 2, paddingHorizontal: space.lg - 1 },
  fieldError: { borderColor: color.danger },
  fieldInput: { flex: 1, ...type.body, paddingVertical: space.md },

  iconButton: { width: touch.min, height: touch.min, borderRadius: radius.control, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: -6, right: -6, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: radius.pill, backgroundColor: color.danger, alignItems: "center", justifyContent: "center" },
  badgeText: { fontWeight: "700" },
});
