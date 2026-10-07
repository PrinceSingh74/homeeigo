import type { LucideIcon } from "lucide-react-native";
import { CloudOff, Hourglass, WifiOff } from "lucide-react-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, Card, EmptyState, SkeletonCard, T } from "@/components/ui";
import { useRefresh, type RefreshKey } from "@/hooks/money/queries";
import { getErrorMessage, isNetworkError } from "@/lib/api-error";
import { space } from "@/theme/tokens";

/**
 * The frame and the states every money / work / performance screen shares: a back control, pull to
 * refresh, loading with the shape of the content, a refusal in the server's own sentence with
 * "Try again", no connection told apart from a refusal, and `null` from the server as a stated
 * "not available" — never as an empty result and never as an error.
 */

export const OFFLINE_SENTENCE = "You're offline. Check your connection and try again.";

/** The sentence for a failed read or action: the offline line, else what the server said. */
export function failureSentence(error: unknown, fallback?: string): string {
  return isNetworkError(error) ? OFFLINE_SENTENCE : getErrorMessage(error, fallback);
}

export function HqScreen({
  title,
  subtitle,
  refresh = [],
  footer,
  headerAction,
  showBack = true,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Query-key prefixes a pull-to-refresh asks again (`K.payouts`, `K.earnings`, …). */
  refresh?: readonly RefreshKey[];
  /** The screen's one primary action, docked. */
  footer?: ReactNode;
  headerAction?: ReactNode;
  showBack?: boolean;
  children: ReactNode;
}) {
  const { refreshing, onRefresh } = useRefresh(refresh);
  return (
    <PartnerScreen
      title={title}
      subtitle={subtitle}
      showBack={showBack}
      footer={footer}
      headerAction={headerAction}
      refreshing={refreshing}
      onRefresh={refresh.length > 0 ? onRefresh : undefined}
    >
      <View style={styles.stack}>{children}</View>
    </PartnerScreen>
  );
}

/** A titled group. The title is a real heading; `action` sits at its right. */
export function Block({ title, action, caption, children }: { title: string; action?: ReactNode; caption?: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <View style={styles.blockHead}>
        <T kind="heading" accessibilityRole="header" style={styles.blockTitle}>
          {title}
        </T>
        {action}
      </View>
      {children}
      {caption ? <T kind="small">{caption}</T> : null}
    </View>
  );
}

/** Tiles side by side, wrapping on a narrow phone. */
export function Grid({ children, accessibilityLabel }: { children: ReactNode; accessibilityLabel?: string }) {
  return (
    <View style={styles.grid} accessibilityLabel={accessibilityLabel}>
      {children}
    </View>
  );
}

export function LoadingCards({ label = "Loading…", cards = 2 }: { label?: string; cards?: number }) {
  return (
    <View style={styles.stack} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      {Array.from({ length: cards }, (_, i) => (
        <SkeletonCard key={i} lines={i === 0 ? 2 : 3} />
      ))}
    </View>
  );
}

/** A read that failed: what happened (the server's sentence, or the offline line) and "Try again". */
export function QueryError({ error, title, onRetry, testID }: { error: unknown; title: string; onRetry: () => void; testID?: string }) {
  const offline = isNetworkError(error);
  return (
    <Card testID={testID}>
      <View accessible accessibilityRole="alert">
        <EmptyState
          icon={offline ? WifiOff : CloudOff}
          title={offline ? "You're offline" : title}
          message={offline ? "Check your connection and try again." : getErrorMessage(error)}
        />
      </View>
      <Button label="Try again" variant="secondary" onPress={onRetry} />
    </Card>
  );
}

/** Something the server does not offer this partner yet: stated, inert, no numbers. */
export function NotAvailable({ title, message, icon = Hourglass, testID }: { title: string; message: string; icon?: LucideIcon; testID?: string }) {
  return (
    <Card testID={testID}>
      <EmptyState icon={icon} title={title} message={message} />
    </Card>
  );
}

type QueryLike<T> = { data: T | undefined; error: unknown; isError: boolean; refetch: () => Promise<unknown> };

/**
 * Renders one read's state. `children` only ever sees data that arrived (never `undefined`, never
 * `null`); a `null` answer goes to `whenNull`. If a refresh fails while older data is on screen, the
 * data stays and a line says it could not be refreshed.
 */
export function Loadable<T>({
  query,
  errorTitle,
  loadingLabel,
  loadingCards,
  whenNull,
  children,
}: {
  query: QueryLike<T>;
  errorTitle: string;
  loadingLabel?: string;
  loadingCards?: number;
  whenNull?: ReactNode;
  children: (data: NonNullable<T>) => ReactNode;
}) {
  if (query.data === undefined) {
    if (query.isError) return <QueryError error={query.error} title={errorTitle} onRetry={() => void query.refetch()} />;
    return <LoadingCards label={loadingLabel} cards={loadingCards} />;
  }
  return (
    <>
      {query.isError ? (
        <Banner
          tone="warning"
          title="Could not refresh"
          message={`${failureSentence(query.error)} Showing what was loaded earlier.`}
          action={<Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />}
        />
      ) : null}
      {query.data === null ? (whenNull ?? null) : children(query.data as NonNullable<T>)}
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  block: { gap: space.md },
  blockHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  blockTitle: { flex: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
});
