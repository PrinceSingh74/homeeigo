import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chips } from "@/components/account/controls";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, failure, type ActionResult } from "@/components/account/states";
import { openJob } from "@/components/home/JobCard";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, Card, EmptyState, Field, KeyValue, ListRow, Pill, Sheet, T } from "@/components/ui";
import { useAuthed, usePagedQuery, usePullRefresh } from "@/hooks/account/queries";
import { SUPPORT_CATEGORIES, SUPPORT_PRIORITIES, canReply, isOwnMessage, supportDraftErrors, ticketStatusLabel, ticketStatusTone } from "@/lib/account-rules";
import { errorSentence } from "@/lib/error-sentence";
import { formatDateTime } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space } from "@/theme/tokens";
import type { PartnerSupportTicket } from "@/types/partner";

const PAGE_SIZE = 20;
type Category = (typeof SUPPORT_CATEGORIES)[number];
type Priority = (typeof SUPPORT_PRIORITIES)[number]["value"];
type TicketsPage = { tickets: PartnerSupportTicket[]; total: number; page: number };

function NewTicketSheet({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (message: string, id: string) => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<Category | null>(null);
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [bookingRef, setBookingRef] = useState("");
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<ActionResult>(null);
  const errors = supportDraftErrors({ subject, description, category: category ?? "", bookingRef });
  const create = useMutation({
    mutationFn: () =>
      partnerApi.support.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        category: category!,
        priorityLevel: priority,
        ...(bookingRef.trim() ? { bookingId: bookingRef.trim() } : {}),
      }),
    onMutate: () => setProblem(null),
    onSuccess: async (ticket) => {
      await qc.invalidateQueries({ queryKey: ["partner", "support"] });
      onCreated(`Ticket ${ticket.ticketNumber} created with ${ticket.priorityLevel} priority.${ticket.slaDueAt ? ` Support aims to respond by ${formatDateTime(ticket.slaDueAt)}.` : ""}`, ticket.id);
      onClose();
    },
    onError: (e) => setProblem(failure(e, "The ticket could not be created.")),
  });
  const submit = () => {
    setTouched(true);
    if (Object.keys(errors).length === 0) create.mutate();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="New support ticket" dismissable={!create.isPending} testID="support-new-sheet" footer={<Button label="Send to support" onPress={submit} loading={create.isPending} testID="support-create" />}>
      <T kind="smallStrong" tone="slate">
        What is this about?
      </T>
      <Chips label="What is this about" options={SUPPORT_CATEGORIES.map((c) => ({ id: c, label: c }))} value={category ? [category] : []} onToggle={setCategory} disabled={create.isPending} testID="support-category" />
      {touched && errors.category ? (
        <T kind="small" tone="danger" accessibilityRole="alert">
          {errors.category}
        </T>
      ) : null}
      <Field label="Subject" value={subject} onChangeText={setSubject} maxLength={200} error={touched ? errors.subject : null} testID="support-subject" />
      <Field label="What happened" value={description} onChangeText={setDescription} multiline maxLength={5000} error={touched ? errors.description : null} help="At least 10 characters." testID="support-description" />
      <Field label="Booking number (optional)" value={bookingRef} onChangeText={setBookingRef} autoCapitalize="characters" autoCorrect={false} help="If this is about one job, enter its booking number." testID="support-booking" />
      <T kind="smallStrong" tone="slate">
        Priority
      </T>
      <Chips label="Priority" options={SUPPORT_PRIORITIES.map((p) => ({ id: p.value, label: p.label }))} value={[priority]} onToggle={setPriority} disabled={create.isPending} testID="support-priority" />
      <ResultBanner result={problem} testID="support-create-error" />
    </Sheet>
  );
}

function TicketDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const enabled = useAuthed();
  const ticket = useQuery({ queryKey: ["partner", "support", "ticket", id], queryFn: () => partnerApi.support.ticketById(id), enabled });
  const { refreshing, onRefresh } = usePullRefresh(ticket);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const reply = useMutation({
    mutationFn: () => partnerApi.support.reply(id, body.trim()),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      setBody("");
      await qc.invalidateQueries({ queryKey: ["partner", "support"] });
      setResult({ tone: "success", message: "Your reply was sent." });
    },
    onError: (e) => setResult(failure(e, "Your reply could not be sent.")),
  });
  const t = ticket.data;
  const open = t ? canReply(t.status) : false;
  return (
    <PartnerScreen
      title={t ? t.ticketNumber : "Ticket"}
      showBack
      onBack={onBack}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        t && open ? (
          <>
            <Field label="Your reply" value={body} onChangeText={setBody} multiline maxLength={5000} testID="support-reply-body" />
            <Button label="Send reply" onPress={() => reply.mutate()} loading={reply.isPending} disabled={body.trim().length === 0} testID="support-reply-send" />
          </>
        ) : undefined
      }
    >
      <View style={styles.body}>
        {ticket.isLoading ? (
          <ListSkeleton cards={2} label="Loading the ticket" />
        ) : !t ? (
          <ErrorState error={ticket.error} title="This ticket could not be loaded" onRetry={() => void ticket.refetch()} />
        ) : (
          <>
            <Card testID="support-ticket">
              <View style={styles.stack}>
                <View style={styles.head}>
                  <T kind="heading" style={styles.flex}>
                    {t.subject}
                  </T>
                  <Pill label={ticketStatusLabel(t.status)} tone={ticketStatusTone(t.status)} />
                </View>
                <T kind="body">{t.description}</T>
                <KeyValue label="About" value={t.category} />
                <KeyValue label="Priority" value={t.priorityLevel} />
                <KeyValue label="Opened" value={formatDateTime(t.createdAt)} />
                {t.slaDueAt && !t.firstResponseAt ? <KeyValue label="Response due by" value={formatDateTime(t.slaDueAt)} /> : null}
                {t.resolution ? <Banner tone="success" title="Resolution" message={t.resolution} /> : null}
                {t.bookingId ? <Button label="Open the job" variant="secondary" onPress={() => openJob(t.bookingId!)} testID="support-open-job" /> : null}
              </View>
            </Card>
            <T kind="heading" accessibilityRole="header">
              Messages
            </T>
            {t.messages.length === 0 ? (
              <T kind="small">No replies yet. Support's answer appears here.</T>
            ) : (
              t.messages.map((m) => {
                const mine = isOwnMessage(m.authorRole);
                return (
                  <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]} accessible accessibilityLabel={`${mine ? "You" : "Support"}, ${formatDateTime(m.createdAt)}: ${m.body}`}>
                    <T kind="caption">
                      {mine ? "You" : "Support"} · {formatDateTime(m.createdAt)}
                    </T>
                    <T kind="body">{m.body}</T>
                  </View>
                );
              })
            )}
            {!open ? <Banner tone="info" message="This ticket is closed and cannot be replied to. Open a new ticket if you still need help." /> : t.status === "resolved" ? <T kind="small">Replying to a resolved ticket reopens it.</T> : null}
            <ResultBanner result={result} testID="support-reply-result" />
          </>
        )}
      </View>
    </PartnerScreen>
  );
}

export function AccountSupportScreen() {
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const list = usePagedQuery<TicketsPage, PartnerSupportTicket>({
    baseKey: ["partner", "support"],
    fetchPage: (page) => partnerApi.support.tickets({ page, limit: PAGE_SIZE }),
    items: (p) => p.tickets,
    total: (p) => p.total,
    pageSize: PAGE_SIZE,
  });
  const { refreshing, onRefresh } = usePullRefresh(list);

  if (openId) return <TicketDetail id={openId} onBack={() => setOpenId(null)} />;

  return (
    <AccountScreen title="Help and support" refreshing={refreshing} onRefresh={onRefresh} footer={<Button label="New support ticket" onPress={() => setCreating(true)} testID="support-new" />}>
      <ResultBanner result={result} testID="support-result" />
      {list.isLoading ? (
        <ListSkeleton cards={3} lines={2} label="Loading your tickets" />
      ) : list.error ? (
        <ErrorState error={list.error} title="Your tickets could not be loaded" onRetry={() => void list.refetch()} />
      ) : list.rows.length === 0 ? (
        <EmptyState icon={LifeBuoy} title="No support tickets" message="Questions you send to the HOMEEIGO support team appear here with their replies." testID="support-empty" />
      ) : (
        <>
          <Card>
            {list.rows.map((t, i) => (
              <ListRow
                key={t.id}
                testID={`support-ticket-${t.id}`}
                title={t.subject}
                subtitle={`${t.ticketNumber} · ${t.category} · updated ${formatDateTime(t.updatedAt)}`}
                value={ticketStatusLabel(t.status)}
                tone={ticketStatusTone(t.status)}
                icon={LifeBuoy}
                onPress={() => setOpenId(t.id)}
                last={i === list.rows.length - 1}
              />
            ))}
          </Card>
          {list.moreError ? <Banner tone="warning" message={errorSentence(list.moreError, "More tickets could not be loaded.")} /> : null}
          {list.hasMore || list.isLoadingMore || list.moreError ? <Button label={list.moreError ? "Try again" : "Load more"} variant="secondary" onPress={list.loadMore} loading={list.isLoadingMore} testID="support-load-more" /> : null}
        </>
      )}
      {creating ? <NewTicketSheet visible onClose={() => setCreating(false)} onCreated={(message) => setResult({ tone: "success", message })} /> : null}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  stack: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  flex: { flex: 1 },
  bubble: { padding: space.md, borderRadius: radius.card, borderWidth: 1, gap: space.xs, maxWidth: "92%" },
  bubbleMine: { alignSelf: "flex-end", backgroundColor: color.leafWash, borderColor: color.line },
  bubbleTheirs: { alignSelf: "flex-start", backgroundColor: color.surface, borderColor: color.line },
});
