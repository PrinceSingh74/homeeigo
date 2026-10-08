import { Check } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { useRevealInScroll } from "@/components/screen-scroll";
import { Banner, Button, Skeleton, T } from "@/components/ui";
import { failureSentence } from "@/lib/job-screen";
import { color, radius, space, touch, type, type Tone } from "@/theme/tokens";

/** Room kept clear under a note field once the keyboard is up: the Confirm button under it and its gap. */
const NOTE_CONTROL_ALLOWANCE = touch.min + space.md;

/** Small pieces the job panels share, all on the tokens. */

/** A label over a group of lines inside a section. */
export function SubHeading({ children }: { children: string }) {
  return (
    <T kind="smallStrong" tone="slate" accessibilityRole="header">
      {children}
    </T>
  );
}

/** Lines of server text, one per row, with a plain dot. */
export function BulletList({ items, tone: textTone, testID, label }: { items: readonly string[]; tone?: Tone; testID?: string; label?: string }) {
  if (items.length === 0) return null;
  return (
    <View testID={testID} style={styles.group} accessible={!!label} accessibilityLabel={label ? `${label}: ${items.join(", ")}` : undefined}>
      {label ? <SubHeading>{label}</SubHeading> : null}
      {items.map((item, i) => (
        <View key={`${i}-${item}`} style={styles.bulletRow}>
          <View style={styles.bullet} />
          <T kind="body" tone={textTone ?? "ink"} style={styles.flex}>
            {item}
          </T>
        </View>
      ))}
    </View>
  );
}

/** A 48-pt checkbox row. `flag` is a line under the label that is announced (what is still needed). */
export function CheckRow({
  label,
  checked,
  onPress,
  flag,
  disabled,
  testID,
  accessibilityLabel,
}: {
  label: string;
  checked: boolean;
  onPress: () => void;
  flag?: string | null;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked, disabled: !!disabled }}
      style={({ pressed }) => [styles.checkRow, pressed ? styles.pressed : null]}
    >
      <View style={[styles.checkBox, checked ? styles.checkBoxOn : null]}>{checked ? <Check color={color.onLeaf} size={16} /> : null}</View>
      <View style={styles.flex}>
        <T kind="body" tone={checked ? "slate" : "ink"}>
          {label}
        </T>
        {flag ? (
          <T kind="small" tone="danger" accessibilityRole="alert">
            {flag}
          </T>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A labelled multi-line input for a note or a reason. The label is always visible. */
export function NoteField({
  label,
  value,
  onChangeText,
  help,
  error,
  maxLength,
  testID,
  autoFocus,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  help?: string | null;
  error?: string | null;
  maxLength: number;
  testID?: string;
  autoFocus?: boolean;
}) {
  // On focus, ask the screen to keep the field and the control under it (Confirm) above the
  // keyboard and the docked footer: the OS alone brings only the field into view.
  const wrap = useRef<View>(null);
  const reveal = useRevealInScroll();
  return (
    <View ref={wrap} collapsable={false} style={styles.noteField}>
      <T kind="smallStrong" tone="slate">
        {label}
      </T>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        maxLength={maxLength}
        multiline
        autoFocus={autoFocus}
        onFocus={() => reveal(wrap.current, NOTE_CONTROL_ALLOWANCE)}
        accessibilityLabel={label}
        accessibilityHint={error ?? help ?? undefined}
        placeholderTextColor={color.mist}
        textAlignVertical="top"
        style={[styles.noteInput, error ? styles.noteInputError : null]}
      />
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

/**
 * Room for the iOS keyboard under a sheet's actions. The ui kit's `Sheet` is a `Modal`, and an iOS
 * modal is not moved by the keyboard: without this the field at the bottom of a sheet sits behind
 * it. Android resizes the window itself (`adjustResize`), so nothing is added there.
 */
export function KeyboardSpacer() {
  // The kit's Sheet now makes room for the iOS keyboard itself (components/ui): nothing to add here.
  return null;
}

/** Loading with the shape of a few lines. */
export function PanelLoading({ lines = 3, label }: { lines?: number; label: string }) {
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.group}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </View>
  );
}

/** A failed load: the server's sentence (or the offline one) and a way to ask again. Never looks like "nothing here". */
export function PanelError({ error, onRetry, retrying, testID }: { error: unknown; onRetry: () => void; retrying?: boolean; testID?: string }) {
  return (
    <Banner
      tone="danger"
      testID={testID}
      message={failureSentence(error, "This could not be loaded.")}
      action={<Button label="Try again" variant="secondary" onPress={onRetry} loading={retrying} />}
    />
  );
}

/** A line that says there is nothing in this section, in words. */
export function PanelEmpty({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <T kind="small" testID={testID}>
      {children}
    </T>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  group: { gap: space.sm },
  bulletRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  bullet: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: color.mist, marginTop: space.sm },
  checkRow: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm, borderRadius: radius.control },
  pressed: { backgroundColor: color.well },
  checkBox: { width: 26, height: 26, borderRadius: radius.control / 2, borderWidth: 2, borderColor: color.slate, backgroundColor: color.surface, alignItems: "center", justifyContent: "center" },
  checkBoxOn: { backgroundColor: color.leaf, borderColor: color.leaf },
  noteField: { gap: space.xs + 2 },
  noteInput: { ...type.body, minHeight: touch.min * 2, borderWidth: 1, borderColor: color.line, borderRadius: radius.control, backgroundColor: color.surface, paddingHorizontal: space.lg, paddingVertical: space.md },
  noteInputError: { borderColor: color.danger },
});
