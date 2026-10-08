import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { BellOff, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { IconButton, SwitchRow } from "@/components/account/controls";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, failure, type ActionResult } from "@/components/account/states";
import { Banner, Button, Card, EmptyState, T } from "@/components/ui";
import { useAuthed, usePagedQuery, usePullRefresh } from "@/hooks/account/queries";
import { channelUnavailableSentence } from "@/lib/account-rules";
import { errorSentence } from "@/lib/error-sentence";
import { formatDateTime } from "@/lib/format";
import { notificationBookingId, resolveNotificationHref } from "@/lib/notification-routing";
import { partnerApi, type NotificationCategoryName, type NotificationChannelName } from "@/services/partner-api";
import { color, radius, space, touch } from "@/theme/tokens";
import type { PartnerNotification, PartnerNotificationsResponse } from "@/types/partner";

const CHANNEL_LABEL: Record<NotificationChannelName, string> = { IN_APP: "In-app", PUSH: "Push", EMAIL: "Email", SMS: "SMS" };
const PAGE_SIZE = 20;

/**
 * Where a row leads, or null when it leads nowhere: a booking notification opens its job; payment
 * and rating notifications open their screens. Anything else is only marked read — it is not sent
 * to the jobs list just to have somewhere to go.
 */
function targetOf(n: PartnerNotification): string | null {
  const href = resolveNotificationHref(n);
  if (notificationBookingId(n)) return href;
  return href === "/(tabs)/requests" ? null : href;
}

/** Optional alerts: the server's matrix, one switch per channel. A switch that fails says so and goes back. */
function PreferencesCard() {
  const qc = useQueryClient();
  const enabled = useAuthed();
  const prefs = useQuery({ queryKey: ["partner", "notification-preferences"], queryFn: () => partnerApi.notifications.preferences(), enabled, staleTime: 60_000 });
  const [failed, setFailed] = useState<ActionResult>(null);
  const setPreference = useMutation({
    mutationFn: (input: { channel: NotificationChannelName; category: NotificationCategoryName; enabled: boolean }) => partnerApi.notifications.setPreference(input),
    onMutate: () => setFailed(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partner", "notification-preferences"] }),
    onError: (e, input) => setFailed(failure(e, `${CHANNEL_LABEL[input.channel]} alerts could not be changed.`)),
  });
  const optional = (prefs.data?.matrix ?? []).filter((c) => c.category === "OPTIONAL");
  return (
    <Card testID="notification-preferences">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header">
          Optional alerts
        </T>
        <T kind="small">Job, payment and security messages are always delivered.</T>
        {prefs.isLoading ? (
          <T kind="small">Loading preferences…</T>
        ) : !prefs.data ? (
          <>
            <Banner tone="warning" message={`Could not load preferences. ${errorSentence(prefs.error)}`} />
            <Button label="Try again" variant="secondary" onPress={() => void prefs.refetch()} />
          </>
        ) : optional.length === 0 ? (
          <T kind="small">There are no optional alerts to choose right now.</T>
        ) : (
          optional.map((cell) => (
            <SwitchRow
              key={cell.channel}
              testID={`notification-pref-${cell.channel}`}
              label={CHANNEL_LABEL[cell.channel]}
              help={!cell.available ? channelUnavailableSentence(cell.unavailableReason) : !cell.editable ? "This cannot be changed." : null}
              value={cell.enabled}
              disabled={!cell.editable || !cell.available}
              busy={setPreference.isPending && setPreference.variables?.channel === cell.channel}
              onChange={(next) => setPreference.mutate({ channel: cell.channel, category: cell.category, enabled: next })}
            />
          ))
        )}
        <ResultBanner result={failed} testID="notification-pref-error" />
      </View>
    </Card>
  );
}

export function AccountNotificationsScreen() {
  const qc = useQueryClient();
  const list = usePagedQuery<PartnerNotificationsResponse, PartnerNotification>({
    baseKey: ["partner", "notifications"],
    fetchPage: (page) => partnerApi.notifications.list({ page, limit: PAGE_SIZE }),
    items: (p) => p.notifications,
    total: (p) => p.total,
    pageSize: PAGE_SIZE,
  });
  const { refreshing, onRefresh } = usePullRefresh(list, { refetch: () => qc.invalidateQueries({ queryKey: ["partner", "notification-preferences"] }) });
  const [result, setResult] = useState<ActionResult>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["partner", "notifications"] });
  const unreadCount = (list.first as PartnerNotificationsResponse | undefined)?.unreadCount ?? 0;

  const markRead = useMutation({
    mutationFn: (id: string) => partnerApi.notifications.markRead(id),
    onSuccess: refresh,
    onError: (e) => setResult(failure(e, "That notification could not be marked as read.")),
  });
  const markAll = useMutation({
    mutationFn: () => partnerApi.notifications.markAllRead(),
    onMutate: () => setResult(null),
    onSuccess: async (data) => {
      await refresh();
      setResult({ tone: "success", message: data.count === 0 ? "Everything was already read." : `${data.count} ${data.count === 1 ? "notification" : "notifications"} marked as read.` });
    },
    onError: (e) => setResult(failure(e, "Notifications could not be marked as read.")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => partnerApi.notifications.remove(id),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await refresh();
      setResult({ tone: "success", message: "Notification deleted." });
    },
    onError: (e) => setResult(failure(e, "That notification could not be deleted.")),
  });

  function open(n: PartnerNotification) {
    if (!n.isRead) markRead.mutate(n.id);
    const href = targetOf(n);
    if (href) router.push(href as never);
  }

  return (
    <AccountScreen title="Notifications" refreshing={refreshing} onRefresh={onRefresh}>
      <PreferencesCard />
      <View style={styles.listHead}>
        <T kind="heading" accessibilityRole="header" style={styles.flex} testID="notifications-unread">
          {unreadCount > 0 ? `${unreadCount} unread` : "Inbox"}
        </T>
        <Button label="Mark all read" variant="quiet" onPress={() => markAll.mutate()} loading={markAll.isPending} disabled={unreadCount === 0} testID="notifications-mark-all" />
      </View>
      <ResultBanner result={result} testID="notifications-result" />
      {list.isLoading ? (
        <ListSkeleton cards={3} lines={2} label="Loading notifications" />
      ) : list.error ? (
        <ErrorState error={list.error} title="Your notifications could not be loaded" onRetry={() => void list.refetch()} />
      ) : list.rows.length === 0 ? (
        <EmptyState icon={BellOff} title="No notifications" message="Job offers, payments and messages from HOMEEIGO appear here." testID="notifications-empty" />
      ) : (
        <>
          {list.rows.map((n) => {
            const href = targetOf(n);
            return (
              <View key={n.id} style={[styles.row, n.isRead ? null : styles.rowUnread]} testID={`notification-${n.id}`}>
                <Pressable
                  onPress={() => open(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.isRead ? "" : "Unread. "}${n.title}. ${n.message}. ${formatDateTime(n.createdAt)}`}
                  accessibilityHint={href ? (notificationBookingId(n) ? "Opens the job" : "Opens the related screen") : n.isRead ? undefined : "Marks it as read"}
                  style={({ pressed }) => [styles.rowMain, pressed ? styles.pressed : null]}
                >
                  <View style={styles.titleRow}>
                    {n.isRead ? null : <View style={styles.dot} />}
                    <T kind="bodyStrong" style={styles.flex}>
                      {n.title}
                    </T>
                  </View>
                  <T kind="small" tone="ink">
                    {n.message}
                  </T>
                  <T kind="caption" numeric>
                    {formatDateTime(n.createdAt)}
                    {href ? (notificationBookingId(n) ? " · opens the job" : " · opens a screen") : ""}
                  </T>
                </Pressable>
                <IconButton icon={Trash2} label={`Delete notification: ${n.title}`} tone="neutral" onPress={() => remove.mutate(n.id)} busy={remove.isPending && remove.variables === n.id} disabled={remove.isPending} testID={`notification-delete-${n.id}`} />
              </View>
            );
          })}
          {list.moreError ? <Banner tone="warning" message={errorSentence(list.moreError, "More notifications could not be loaded.")} /> : null}
          {list.hasMore || list.isLoadingMore || list.moreError ? (
            <Button label={list.moreError ? "Try again" : "Load more"} variant="secondary" onPress={list.loadMore} loading={list.isLoadingMore} testID="notifications-load-more" />
          ) : null}
        </>
      )}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  flex: { flex: 1 },
  listHead: { flexDirection: "row", alignItems: "center", gap: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: space.md },
  rowUnread: { borderColor: color.leaf, backgroundColor: color.leafWash },
  rowMain: { flex: 1, minHeight: touch.min, gap: space.xs, borderRadius: radius.control, padding: space.xs },
  pressed: { backgroundColor: color.well },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.leaf },
});
