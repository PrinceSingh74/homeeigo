import { CloudOff, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, Card, Skeleton, SkeletonCard, T } from "@/components/ui";
import { errorSentence, isOfflineError } from "@/lib/error-sentence";
import { color, radius, space } from "@/theme/tokens";

/**
 * The states every data screen has, in one place: loading with the shape of the content, a failure
 * that says whether the app is offline or the server refused (in the server's words), and the
 * outcome of an action.
 */

/** A read failed. Offline and a refusal are different sentences; both can be tried again. */
export function ErrorState({ error, onRetry, title, testID }: { error: unknown; onRetry?: () => void; title?: string; testID?: string }) {
  const offline = isOfflineError(error);
  const Icon = offline ? WifiOff : CloudOff;
  return (
    <View testID={testID} style={styles.state} accessible accessibilityRole="alert">
      <View style={[styles.stateIcon, offline ? styles.stateIconWarn : styles.stateIconDanger]}>
        <Icon color={offline ? color.marigold : color.danger} size={24} />
      </View>
      <T kind="heading" style={styles.center}>
        {offline ? "You're offline" : (title ?? "This could not be loaded")}
      </T>
      <T kind="small" tone="slate" style={styles.center}>
        {offline ? "Check your connection and try again." : errorSentence(error)}
      </T>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} style={styles.retry} /> : null}
    </View>
  );
}

/** Cards with the shape of a list while it loads. */
export function ListSkeleton({ cards = 3, lines = 3, label = "Loading" }: { cards?: number; lines?: number; label?: string }) {
  return (
    <View style={styles.list} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={lines} />
      ))}
    </View>
  );
}

/** Rows with the shape of a settings list while it loads. */
export function RowsSkeleton({ rows = 4, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <Card>
      <View style={styles.rows} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
        {Array.from({ length: rows }, (_, i) => (
          <View key={i} style={styles.rowSkeleton}>
            <Skeleton height={16} width="45%" />
            <Skeleton height={16} width="25%" />
          </View>
        ))}
      </View>
    </Card>
  );
}

export type ActionResult = { tone: "success" | "danger" | "warning" | "info"; message: string } | null;

/** The result of an action, as a banner: a success in the server's words when it sent some, a failure in its words. */
export function ResultBanner({ result, testID, action }: { result: ActionResult; testID?: string; action?: ReactNode }) {
  if (!result) return null;
  return <Banner tone={result.tone} message={result.message} testID={testID} action={action} />;
}

/** The banner for a failed action: offline is told apart from a refusal. */
export function failure(error: unknown, fallback?: string): NonNullable<ActionResult> {
  return { tone: isOfflineError(error) ? "warning" : "danger", message: errorSentence(error, fallback) };
}

/** An HQ screen: the shared frame with a back control. */
export function AccountScreen({
  title,
  subtitle,
  children,
  footer,
  refreshing,
  onRefresh,
  headerAction,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  headerAction?: ReactNode;
}) {
  return (
    <PartnerScreen title={title} subtitle={subtitle} showBack footer={footer} refreshing={refreshing} onRefresh={onRefresh} headerAction={headerAction}>
      <View style={styles.body}>{children}</View>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  list: { gap: space.md },
  rows: { gap: space.lg },
  rowSkeleton: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  state: { alignItems: "center", paddingVertical: space.xxxl, paddingHorizontal: space.xl, gap: space.sm },
  stateIcon: { width: 56, height: 56, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  stateIconDanger: { backgroundColor: color.dangerWash },
  stateIconWarn: { backgroundColor: color.marigoldWash },
  center: { textAlign: "center" },
  retry: { marginTop: space.md, alignSelf: "stretch" },
});
