import type { LucideIcon } from "lucide-react-native";
import { AlertTriangle, CheckCircle2, ChevronRight, Info, XCircle } from "lucide-react-native";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  TextInput,
  KeyboardAvoidingView,
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { keyboardOverlap } from "@/lib/keyboard-overlap";
import { color, elevation, radius, space, tabular, tone, touch, type, type Tone } from "@/theme/tokens";

/**
 * The partner app's shared building blocks. Screens compose these; they do not restyle them.
 * Every pressable here is at least 48 pt tall, names itself to a screen reader, and says when it
 * is busy or disabled.
 */

/* ------------------------------------------------------------------ text */

type TextKind = keyof typeof type;

export function T({
  kind = "body",
  tone: textTone,
  numeric,
  style,
  children,
  ...rest
}: {
  kind?: TextKind;
  /** A semantic colour; omit for the kind's own. */
  tone?: Tone | "ink" | "slate" | "mist" | "onLeaf";
  /** Digits that line up (money, times, counts). */
  numeric?: boolean;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
} & Omit<React.ComponentProps<typeof Text>, "style" | "children">) {
  const tint =
    textTone === "ink" ? color.ink : textTone === "slate" ? color.slate : textTone === "mist" ? color.mist : textTone === "onLeaf" ? color.onLeaf : textTone ? tone[textTone].fg : undefined;
  return (
    <Text {...rest} style={[type[kind], numeric ? tabular : null, tint ? { color: tint } : null, style]}>
      {children}
    </Text>
  );
}

/**
 * Rupees as the server gave them: paise are never rounded away. An amount the server did not send
 * is a dash, never an invented zero.
 */
export function formatRupees(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/* ---------------------------------------------------------------- button */

type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon: Icon,
  loading = false,
  disabled = false,
  /** Shown under the label when the action is unavailable: why, in the server's words where it has them. */
  hint,
  accessibilityLabel,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  hint?: string | null;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || loading;
  const palette = {
    primary: { bg: color.leaf, pressed: color.leafPressed, fg: color.onLeaf, border: color.leaf },
    secondary: { bg: color.surface, pressed: color.well, fg: color.leaf, border: color.line },
    quiet: { bg: "transparent", pressed: color.well, fg: color.leaf, border: "transparent" },
    danger: { bg: color.surface, pressed: color.dangerWash, fg: color.danger, border: tone.danger.border },
  }[variant];
  return (
    <View style={style}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={off}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={hint ?? undefined}
        accessibilityState={{ disabled: off, busy: loading }}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: pressed ? palette.pressed : palette.bg, borderColor: palette.border },
          off ? styles.buttonOff : null,
        ]}
      >
        {loading ? <ActivityIndicator color={palette.fg} /> : Icon ? <Icon color={palette.fg} size={20} /> : null}
        <Text style={[type.bodyStrong, styles.buttonLabel, { color: palette.fg }]} numberOfLines={2}>
          {label}
        </Text>
      </Pressable>
      {hint ? (
        <T kind="caption" tone="slate" style={styles.buttonHint}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ card */

export function Card({
  children,
  style,
  padded = true,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} style={[styles.card, padded ? styles.cardPadded : null, style]}>
      {children}
    </View>
  );
}

/** A titled group inside a screen. The title is a real heading for screen readers. */
export function Section({
  title,
  action,
  children,
  style,
}: {
  title: string;
  /** A small control on the right of the title (e.g. "See all"). */
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      <View style={styles.sectionHead}>
        <T kind="heading" accessibilityRole="header">
          {title}
        </T>
        {action}
      </View>
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ pill */

export function Pill({ label, tone: pillTone = "neutral", icon: Icon, testID }: { label: string; tone?: Tone; icon?: LucideIcon; testID?: string }) {
  const t = tone[pillTone];
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: t.bg, borderColor: t.border }]}>
      {Icon ? <Icon color={t.fg} size={14} /> : null}
      <Text style={[type.caption, { color: t.fg, fontWeight: "600" }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- banner */

const BANNER_ICON: Record<Exclude<Tone, "neutral" | "leaf">, LucideIcon> = {
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  info: Info,
};

/**
 * Something the partner needs to read now. `danger` and `warning` are announced as alerts;
 * the others as status. The text is the server's sentence wherever the server wrote one.
 */
export function Banner({
  tone: bannerTone = "info",
  title,
  message,
  action,
  testID,
}: {
  tone?: Exclude<Tone, "neutral" | "leaf">;
  title?: string;
  message: string;
  action?: ReactNode;
  testID?: string;
}) {
  const t = tone[bannerTone];
  const Icon = BANNER_ICON[bannerTone];
  const urgent = bannerTone === "danger" || bannerTone === "warning";
  return (
    <View testID={testID} style={[styles.banner, { backgroundColor: t.bg, borderColor: t.border }]}>
      <Icon color={t.fg} size={20} />
      <View style={styles.bannerBody}>
        {/* Only the words are one accessible element: a screen reader collapses an accessible
            container into a single stop, which made the action button inside it unreachable. */}
        <View accessible accessibilityRole={urgent ? "alert" : "text"} accessibilityLiveRegion={urgent ? "assertive" : "polite"} style={styles.bannerText}>
          {title ? <Text style={[type.smallStrong, { color: t.fg }]}>{title}</Text> : null}
          <Text style={[type.small, { color: color.ink }]}>{message}</Text>
        </View>
        {action ? <View style={styles.bannerAction}>{action}</View> : null}
      </View>
    </View>
  );
}

/* --------------------------------------------------------------- list row */

export function ListRow({
  title,
  subtitle,
  value,
  icon: Icon,
  onPress,
  tone: rowTone = "leaf",
  testID,
  last = false,
}: {
  title: string;
  subtitle?: string | null;
  /** Shown on the right (an amount, a count, a state). */
  value?: string | null;
  icon?: LucideIcon;
  onPress?: () => void;
  tone?: Tone;
  testID?: string;
  /** No hairline under the last row of a group. */
  last?: boolean;
}) {
  const t = tone[rowTone];
  const body = (
    <View style={[styles.row, last ? null : styles.rowLine]}>
      {Icon ? (
        <View style={[styles.rowIcon, { backgroundColor: t.bg }]}>
          <Icon color={t.fg} size={18} />
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <T kind="bodyStrong" numberOfLines={2}>
          {title}
        </T>
        {subtitle ? (
          <T kind="small" numberOfLines={3}>
            {subtitle}
          </T>
        ) : null}
      </View>
      {value ? (
        <T kind="bodyStrong" numeric>
          {value}
        </T>
      ) : null}
      {onPress ? <ChevronRight color={color.mist} size={18} /> : null}
    </View>
  );
  if (!onPress) return <View testID={testID}>{body}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle, value].filter(Boolean).join(". ")}
      style={({ pressed }) => (pressed ? styles.rowPressed : null)}
    >
      {body}
    </Pressable>
  );
}

/** Label on the left, value on the right: a line of a statement or a summary. */
export function KeyValue({ label, value, strong = false, testID }: { label: string; value: string; strong?: boolean; testID?: string }) {
  return (
    <View style={styles.kv} accessible accessibilityLabel={`${label}: ${value}`}>
      <T kind={strong ? "bodyStrong" : "body"} tone={strong ? "ink" : "slate"} style={styles.kvLabel}>
        {label}
      </T>
      <T kind={strong ? "bodyStrong" : "body"} numeric testID={testID} style={styles.kvValue}>
        {value}
      </T>
    </View>
  );
}

/* ------------------------------------------------------- loading / empty */

/** A placeholder with the shape of what is loading. Still for people who asked for less motion. */
export function Skeleton({ height = 16, width = "100%", style }: { height?: number; width?: number | `${number}%`; style?: StyleProp<ViewStyle> }) {
  const pulse = useRef(new Animated.Value(0.55)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled || reduce) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0.55, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [pulse]);
  return <Animated.View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.skeleton, { height, width, opacity: pulse }, style]} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card>
      <Skeleton height={18} width="55%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lines - 1 ? "70%" : "100%"} style={{ marginTop: space.md }} />
      ))}
    </Card>
  );
}

/** An empty or failed state: what happened, and the one thing to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
  testID,
}: {
  icon: LucideIcon;
  title: string;
  message?: string;
  action?: ReactNode;
  testID?: string;
}) {
  return (
    <View testID={testID} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon color={color.leaf} size={26} />
      </View>
      <T kind="heading" style={styles.emptyText}>
        {title}
      </T>
      {message ? (
        <T kind="small" style={styles.emptyText}>
          {message}
        </T>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

/* ------------------------------------------------------- keyboard avoider */

/**
 * Keeps its content above the keyboard by padding its own bottom edge.
 *
 * iOS uses React Native's `KeyboardAvoidingView`. Android does not: there the "keyboard hid" event
 * carries the height of the visible frame where a position is expected, so the stock view kept
 * padding after the keyboard had gone (a sheet floated 48 pt above the bottom edge, a docked footer
 * 24 pt above its place). Here the padding is the measured overlap while the keyboard is shown and
 * nothing once it is hidden (`keyboardOverlap`).
 */
export function KeyboardAvoider({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useRef<View>(null);
  const [pad, setPad] = useState(0);
  useEffect(() => {
    if (Platform.OS === "ios") return;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const keyboardTop = e?.endCoordinates?.screenY;
      const node = ref.current;
      if (!node) return;
      // `measure`, not `measureInWindow`: on Android the latter is counted from under the status bar,
      // which left a docked footer one status bar's height under the keyboard.
      node.measure((_x, _y, _w, h, _pageX, pageY) => setPad(keyboardOverlap({ visible: true, viewBottom: pageY + h, keyboardTop })));
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setPad(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (Platform.OS === "ios") {
    return (
      <KeyboardAvoidingView behavior="padding" style={style}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <View ref={ref} collapsable={false} style={[style, pad > 0 ? { paddingBottom: pad } : null]}>
      {children}
    </View>
  );
}

/* ----------------------------------------------------------------- sheet */

/**
 * A bottom sheet: rises from the thumb's side of the screen, closes on the scrim or the hardware
 * back button, keeps its actions above the home indicator, and is a modal to a screen reader.
 */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
  dismissable = true,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Actions pinned under the content. */
  footer?: ReactNode;
  /** False while something is being sent: neither the scrim nor back closes it. */
  dismissable?: boolean;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  // A modal is not moved by the keyboard on iOS, and under Android edge-to-edge its window is not
  // resized either. The avoider pads by how much the keyboard actually overlaps the sheet, so it
  // adds nothing where the window was resized. Every sheet with an input gets this without asking.
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={() => (dismissable ? onClose() : undefined)}>
      <KeyboardAvoider style={styles.sheetRoot}>
        {/* The scrim is a button only while it can close the sheet; otherwise it is not announced. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => (dismissable ? onClose() : undefined)}
          accessible={dismissable}
          accessibilityLabel={dismissable ? "Close" : undefined}
          accessibilityRole={dismissable ? "button" : undefined}
          importantForAccessibility={dismissable ? "yes" : "no"}
        >
          <View style={styles.scrim} />
        </Pressable>
        <View testID={testID} accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={styles.sheetGrip} />
          <T kind="title" accessibilityRole="header" style={styles.sheetTitle}>
            {title}
          </T>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </View>
      </KeyboardAvoider>
    </Modal>
  );
}

/* ----------------------------------------------------------------- field */

/**
 * A labelled input. The label is always visible (never only a placeholder), the error sits under
 * the field and is announced, and the control is 52 pt tall.
 */
export function Field({
  label,
  value,
  onChangeText,
  error,
  help,
  secure = false,
  testID,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  /** A line of guidance under the field when there is no error. */
  help?: string;
  secure?: boolean;
  testID?: string;
} & Omit<React.ComponentProps<typeof TextInput>, "value" | "onChangeText" | "style" | "secureTextEntry">) {
  const [hidden, setHidden] = useState(secure);
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <T kind="smallStrong" tone="slate">
        {label}
      </T>
      <View style={[styles.fieldBox, focused ? styles.fieldFocused : null, error ? styles.fieldError : null]}>
        <TextInput
          {...input}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          accessibilityLabel={input.accessibilityLabel ?? label}
          accessibilityHint={error ?? help}
          secureTextEntry={secure ? hidden : false}
          placeholderTextColor={color.mist}
          onFocus={(e) => {
            setFocused(true);
            input.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            input.onBlur?.(e);
          }}
          style={styles.fieldInput}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} accessibilityRole="button" accessibilityLabel={`${hidden ? "Show" : "Hide"} ${label.toLowerCase()}`} hitSlop={10} style={styles.fieldToggle}>
            <T kind="smallStrong" tone="leaf">
              {hidden ? "Show" : "Hide"}
            </T>
          </Pressable>
        ) : null}
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

/* ------------------------------------------------------------- stage rail */

export type RailStep = { key: string; label: string; /** A time or short note under the label. */ note?: string | null; state: "done" | "current" | "todo" };

/**
 * Where the job stands: a real sequence, so it is drawn as one. The current step is the only
 * filled dot; done steps are ticked; what is ahead is hollow.
 */
export function StageRail({ steps, testID }: { steps: RailStep[]; testID?: string }) {
  return (
    <View testID={testID} accessibilityRole="list" style={styles.rail}>
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <View key={s.key} style={styles.railRow} accessible accessibilityLabel={`${s.label}${s.note ? `, ${s.note}` : ""}, ${s.state === "done" ? "done" : s.state === "current" ? "current step" : "not yet"}`}>
            <View style={styles.railTrack}>
              <View style={[styles.railDot, s.state === "done" ? styles.railDotDone : s.state === "current" ? styles.railDotCurrent : null]}>
                {s.state === "done" ? <CheckCircle2 color={color.onLeaf} size={14} /> : null}
              </View>
              {last ? null : <View style={[styles.railLine, s.state === "done" ? styles.railLineDone : null]} />}
            </View>
            <View style={styles.railText}>
              <T kind={s.state === "current" ? "bodyStrong" : "body"} tone={s.state === "todo" ? "mist" : "ink"}>
                {s.label}
              </T>
              {s.note ? (
                <T kind="caption" numeric>
                  {s.note}
                </T>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ---------------------------------------------------------------- styles */

const styles = StyleSheet.create({
  button: {
    minHeight: touch.min + 4,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingHorizontal: space.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.sm,
  },
  buttonOff: { opacity: 0.5 },
  buttonLabel: { flexShrink: 1, textAlign: "center" },
  buttonHint: { marginTop: space.xs, textAlign: "center" },

  card: { backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, ...elevation.card },
  cardPadded: { padding: space.lg },

  section: { marginTop: space.xxl, gap: space.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },

  pill: { flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start", paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.pill, borderWidth: 1 },

  banner: { flexDirection: "row", gap: space.md, padding: space.lg, borderRadius: radius.control, borderWidth: 1 },
  bannerBody: { flex: 1, gap: 2 },
  bannerText: { gap: 2 },
  bannerAction: { marginTop: space.sm },

  row: { minHeight: touch.min + 8, flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rowLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  rowPressed: { backgroundColor: color.well },
  rowIcon: { width: 36, height: 36, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, gap: 2 },

  kv: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.lg, paddingVertical: space.sm },
  kvLabel: { flexShrink: 1 },
  kvValue: { textAlign: "right" },

  skeleton: { backgroundColor: color.well, borderRadius: radius.control / 2 },

  empty: { alignItems: "center", paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm },
  emptyIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: color.leafWash, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  emptyText: { textAlign: "center" },
  emptyAction: { marginTop: space.md, alignSelf: "stretch" },

  field: { gap: space.xs + 2 },
  fieldBox: { minHeight: touch.min + 4, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: color.line, borderRadius: radius.control, backgroundColor: color.surface, paddingHorizontal: space.lg },
  fieldFocused: { borderColor: color.leaf, borderWidth: 2, paddingHorizontal: space.lg - 1 },
  fieldError: { borderColor: color.danger },
  fieldInput: { flex: 1, ...type.body, paddingVertical: space.md },
  fieldToggle: { minHeight: touch.min, justifyContent: "center", paddingLeft: space.md },

  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1, backgroundColor: color.scrim },
  sheet: { maxHeight: "88%", backgroundColor: color.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: space.md, ...elevation.float },
  sheetGrip: { alignSelf: "center", width: 40, height: 4, borderRadius: radius.pill, backgroundColor: color.line, marginBottom: space.md },
  sheetTitle: { paddingHorizontal: space.xl },
  sheetScroll: { flexGrow: 0 },
  sheetContent: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg, gap: space.md },
  sheetFooter: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },

  rail: { gap: 0 },
  railRow: { flexDirection: "row", gap: space.md, minHeight: 44 },
  railTrack: { width: 22, alignItems: "center" },
  railDot: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, borderColor: color.line, backgroundColor: color.surface, alignItems: "center", justifyContent: "center" },
  railDotDone: { backgroundColor: color.leaf, borderColor: color.leaf },
  railDotCurrent: { borderColor: color.leaf, borderWidth: 6 },
  railLine: { flex: 1, width: 2, backgroundColor: color.line, marginVertical: 2 },
  railLineDone: { backgroundColor: color.leaf },
  railText: { flex: 1, paddingBottom: space.md, gap: 2 },
});
