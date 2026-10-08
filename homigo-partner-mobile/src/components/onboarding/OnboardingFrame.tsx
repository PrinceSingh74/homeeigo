import { Check } from "lucide-react-native";
import { createContext, useContext, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, T } from "@/components/ui";
import { OFFLINE_SENTENCE } from "@/lib/error-sentence";
import { color, radius, space, touch, type } from "@/theme/tokens";

/**
 * The frame every sign-up step sits in: the app's `PartnerScreen`, a line that says where the
 * applicant is ("Step 2 of 10 · Services"), the step's heading, and one primary action docked at the
 * bottom with "Back" beside it. Each step renders its own frame so its primary button can read the
 * step's own state; what is common to all steps comes from the screen through context.
 */

export const SIGN_UP_TITLE = "Become a HOMEEIGO Partner";

export type OnboardingFrameValue = {
  /** "Step 2 of 10 · Services", or null before and after the sequence. */
  indicator: string | null;
  /** How far along the sequence the current step is, 0–1. */
  fraction: number | null;
  /** "Saved 5m ago", from the server's timestamp, on a resumed application. */
  savedLine: string | null;
  /** Banners that belong to the whole application (changes asked for, invite). */
  notices: ReactNode;
  /** Why the last save did not go through: the server's sentence, or the offline sentence. */
  error: string | null;
  /** Null where there is nothing to go back to. */
  onBack: (() => void) | null;
  /** True while a step is being sent. */
  busy: boolean;
};

const FrameContext = createContext<OnboardingFrameValue>({ indicator: null, fraction: null, savedLine: null, notices: null, error: null, onBack: null, busy: false });

export const OnboardingFrameProvider = FrameContext.Provider;

export function OnboardingFrame({
  heading,
  lead,
  subtitle,
  primary,
  secondary,
  error,
  children,
}: {
  heading?: string;
  lead?: string | null;
  /** Under the screen title; only the first screen uses it. */
  subtitle?: string;
  /** The step's one primary action. */
  primary: ReactNode;
  /** A second action under the row (the first screen's "Continue existing application"). */
  secondary?: ReactNode;
  /** A problem the step itself found; shown in place of the screen's. */
  error?: string | null;
  children?: ReactNode;
}) {
  const frame = useContext(FrameContext);
  const problem = error ?? frame.error;
  return (
    <PartnerScreen
      title={SIGN_UP_TITLE}
      subtitle={subtitle}
      footer={
        <>
          {problem ? <Problem message={problem} testID="onboarding-error" /> : null}
          <View style={styles.actions}>
            {frame.onBack ? <Button label="Back" variant="secondary" onPress={frame.onBack} disabled={frame.busy} style={styles.back} /> : null}
            <View style={styles.primary}>{primary}</View>
          </View>
          {secondary}
        </>
      }
    >
      <View style={styles.body}>
        {frame.indicator ? (
          <View style={styles.indicator}>
            <T kind="smallStrong" tone="slate" numeric>
              {frame.indicator}
            </T>
            <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={[styles.fill, { width: `${Math.round(Math.min(1, Math.max(0, frame.fraction ?? 0)) * 100)}%` }]} />
            </View>
            {frame.savedLine ? <T kind="caption">{frame.savedLine}</T> : null}
          </View>
        ) : null}
        {frame.notices}
        {heading ? (
          <View style={styles.head}>
            <T kind="title" accessibilityRole="header">
              {heading}
            </T>
            {lead ? (
              <T kind="body" tone="slate">
                {lead}
              </T>
            ) : null}
          </View>
        ) : null}
        {children}
      </View>
    </PartnerScreen>
  );
}

/**
 * A failed request, said once. Offline is told apart from a refusal by its tone and its own
 * sentence; a refusal is the server's sentence, unchanged. `onRetry` adds "Try again".
 */
export function Problem({ message, onRetry, retrying = false, testID }: { message: string; onRetry?: () => void; retrying?: boolean; testID?: string }) {
  const offline = message === OFFLINE_SENTENCE;
  return (
    <Banner
      testID={testID}
      tone={offline ? "warning" : "danger"}
      message={message}
      action={onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} loading={retrying} /> : undefined}
    />
  );
}

/** A label over a group of choices, with the group's error under it. */
export function ChoiceGroup({ label, error, children }: { label: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={styles.group}>
      <T kind="smallStrong" tone="slate">
        {label}
      </T>
      <View style={styles.chips}>{children}</View>
      {error ? (
        <T kind="small" tone="danger" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </View>
  );
}

/**
 * One choice in a group. Selected is said three ways — a tick, heavier text and the leaf border —
 * and to a screen reader through `accessibilityState`.
 */
export function Choice({
  label,
  selected,
  onPress,
  block = false,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** A full-width row (an answer to a question) instead of a chip. */
  block?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [styles.choice, block ? styles.choiceBlock : null, selected ? styles.choiceOn : null, pressed ? styles.choicePressed : null, disabled ? styles.off : null]}
    >
      {selected ? <Check color={color.leaf} size={16} /> : block ? <View style={styles.choiceDot} /> : null}
      <Text style={[selected ? type.bodyStrong : type.body, styles.choiceText, selected ? styles.choiceTextOn : null]}>{label}</Text>
    </Pressable>
  );
}

/**
 * The kit's primary button without an accessibility label of its own, so its name is its text.
 * Used for "Verify OTP" only: the browser onboarding script finds the code field by the label
 * "OTP", and a labelled button whose name contains "OTP" would be found by that same search.
 */
export function TextNamedPrimaryButton({ label, onPress, loading = false, disabled = false, testID }: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean; testID?: string }) {
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      style={({ pressed }) => [styles.plainButton, pressed ? styles.plainButtonPressed : null, off ? styles.off : null]}
    >
      {loading ? <ActivityIndicator color={color.onLeaf} /> : null}
      <Text style={[type.bodyStrong, styles.plainButtonLabel]} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  indicator: { gap: space.sm },
  track: { height: space.xs, borderRadius: radius.pill, backgroundColor: color.well, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: color.leaf },
  head: { gap: space.xs },

  actions: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  back: { flex: 1 },
  primary: { flex: 2 },

  group: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  choice: {
    minHeight: touch.min,
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  choiceBlock: { alignSelf: "stretch", gap: space.md },
  choiceOn: { borderColor: color.leaf, backgroundColor: color.leafWash },
  choicePressed: { backgroundColor: color.well },
  choiceDot: { width: space.lg, height: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: color.mist },
  choiceText: { flexShrink: 1 },
  choiceTextOn: { color: color.leaf },
  off: { opacity: 0.5 },

  plainButton: {
    minHeight: touch.min + 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.leaf,
    backgroundColor: color.leaf,
    paddingHorizontal: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  plainButtonPressed: { backgroundColor: color.leafPressed, borderColor: color.leafPressed },
  plainButtonLabel: { color: color.onLeaf, flexShrink: 1, textAlign: "center" },
});
