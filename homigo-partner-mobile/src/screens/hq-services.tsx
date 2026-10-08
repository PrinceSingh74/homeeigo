import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AccountScreen, ListSkeleton, ResultBanner } from "@/components/account/states";
import { Group, LoadFailure, StaleBanner, StatusRow } from "@/components/credentials/parts";
import { RequestServiceSheet } from "@/components/services/RequestServiceSheet";
import { Banner, Button, T } from "@/components/ui";
import { usePullRefresh } from "@/hooks/account/queries";
import { CAPABILITIES_KEY, SERVICE_BOARD_KEY, useServiceBoardQuery } from "@/hooks/credentials/queries";
import { formatDate } from "@/lib/format";
import { READINESS_ROUTES, readinessSummary, readinessView, type ReadinessLine } from "@/lib/service-readiness";
import { lanePill, serviceFailure, type Notice } from "@/lib/services-screen";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerServiceSkillBoard, PartnerServiceSkillCard } from "@/types/partner";

/**
 * "My services" — the services this professional performs, has asked for, or has had paused
 * (`GET /api/providers/me/service-skills`), and for each one they perform, whether they are actually
 * being offered its jobs. Being authorised for a service is not the same as being matched for it: a
 * service can require verified identity, a cleared background check, experience, training or
 * credentials, and a professional who misses one is never offered the job. The server reports that as
 * `readiness`; the sentences and next steps come from `lib/service-readiness.ts`. A card without
 * `readiness` (older backend) shows nothing about readiness.
 *
 * One primary action, docked: "Request a service" — offered only while the server takes requests and
 * has a service left to ask for.
 */

const TITLE = "My services";
const SUBTITLE = "The services you perform, and whether you are being offered their jobs.";

/** One thing a performing service still needs, with the screen where it is dealt with. */
function GapLine({ line }: { line: ReadinessLine }) {
  const target = line.target;
  return (
    <View style={styles.gap}>
      <T kind="small" tone="ink">
        {line.text}
      </T>
      {target && line.actionLabel ? <Button label={line.actionLabel} variant="quiet" onPress={() => router.push(READINESS_ROUTES[target])} /> : null}
    </View>
  );
}

function PerformingRow({ card, last }: { card: PartnerServiceSkillCard; last: boolean }) {
  const view = readinessView(card.readiness);
  const pill = lanePill(card.lane, card.readiness);
  return (
    <StatusRow
      testID={`service-${card.lane}-${card.serviceId}`}
      title={card.name}
      subtitle={card.category}
      pills={[pill && view?.ready ? { ...pill, testID: `service-ready-${card.serviceId}` } : pill]}
      last={last}
    >
      {view && !view.ready ? (
        <View testID={`service-not-ready-${card.serviceId}`} style={styles.gaps}>
          {view.lines.map((l, i) => (
            <GapLine key={`${i}-${l.text}`} line={l} />
          ))}
        </View>
      ) : null}
    </StatusRow>
  );
}

function Board({ b, onWithdraw, withdrawing }: { b: PartnerServiceSkillBoard; onWithdraw: (card: PartnerServiceSkillCard) => void; withdrawing: number | null }) {
  const summary = readinessSummary(b.performing);
  return (
    <>
      {summary ? <Banner tone="warning" message={summary} testID="services-readiness-summary" /> : null}

      <Group testID="services-performing" title={`Performing (${b.performing.length})`} isEmpty={b.performing.length === 0} empty="No services yet. The services you chose at signup appear here.">
        {b.performing.map((s, i) => (
          <PerformingRow key={s.serviceId} card={s} last={i === b.performing.length - 1} />
        ))}
      </Group>

      <Group testID="services-pending" title={`Awaiting approval (${b.pending.length})`} isEmpty={b.pending.length === 0} empty="No open requests. A service you ask for appears here until the Homeeigo team decides.">
        {b.pending.map((s, i) => (
          <StatusRow key={s.serviceId} testID={`service-${s.lane}-${s.serviceId}`} title={s.name} subtitle={s.category} pills={[lanePill(s.lane)]} last={i === b.pending.length - 1}>
            {s.requestedAt ? <T kind="small">Requested on {formatDate(s.requestedAt)}</T> : null}
            {s.requestNote ? <T kind="small">Your note: {s.requestNote}</T> : null}
            {s.capabilityId != null ? (
              <Button
                label="Withdraw request"
                variant="secondary"
                onPress={() => onWithdraw(s)}
                loading={withdrawing === s.capabilityId}
                disabled={withdrawing !== null}
                accessibilityLabel={`Withdraw request for ${s.name}`}
                testID={`service-withdraw-${s.serviceId}`}
              />
            ) : null}
          </StatusRow>
        ))}
      </Group>

      {b.suspended.length ? (
        <Group testID="services-suspended" title={`Suspended (${b.suspended.length})`} isEmpty={false} empty="" caption="Paused by the Homeeigo team. You are not offered these jobs until they restore the service.">
          {b.suspended.map((s, i) => (
            <StatusRow key={s.serviceId} testID={`service-${s.lane}-${s.serviceId}`} title={s.name} subtitle={s.category} pills={[lanePill(s.lane)]} last={i === b.suspended.length - 1} />
          ))}
        </Group>
      ) : null}

      {b.revoked.length ? (
        <Group testID="services-revoked" title={`Revoked (${b.revoked.length})`} isEmpty={false} empty="" caption="Removed by the Homeeigo team. Contact support if you think this is wrong.">
          {b.revoked.map((s) => (
            <StatusRow key={s.serviceId} testID={`service-${s.lane}-${s.serviceId}`} title={s.name} subtitle={s.category} pills={[lanePill(s.lane)]} />
          ))}
          <Button label="Contact support" variant="secondary" onPress={() => router.push(READINESS_ROUTES.support)} style={styles.support} />
        </Group>
      ) : null}

      <View testID="services-available" style={styles.available}>
        <T kind="heading" accessibilityRole="header">
          Available to request
        </T>
        <T kind="small">
          {!b.approvalWorkflow
            ? "New service requests are not available yet. The services you chose at signup are unchanged."
            : b.available.length === 0
              ? "Every catalogue service is already on your account. A newly published service will appear here."
              : `${b.available.length} ${b.available.length === 1 ? "service" : "services"} you can ask for. Use Request a service below.`}
        </T>
      </View>
    </>
  );
}

export function MyServicesScreen() {
  const qc = useQueryClient();
  const board = useServiceBoardQuery();
  const { refreshing, onRefresh } = usePullRefresh(board);
  const [requesting, setRequesting] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const b = board.data;

  const withdraw = useMutation({
    mutationFn: (card: PartnerServiceSkillCard) => {
      // Only rows that carry a capability id show the button.
      if (card.capabilityId == null) throw new Error("This request cannot be withdrawn here.");
      return partnerApi.withdrawServiceSkill(card.capabilityId);
    },
    onMutate: () => setNotice(null),
    onSuccess: (_res, card) => setNotice({ tone: "success", message: `Request for ${card.name} withdrawn.` }),
    onError: (e) => setNotice(serviceFailure(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: SERVICE_BOARD_KEY });
      void qc.invalidateQueries({ queryKey: CAPABILITIES_KEY });
    },
  });

  const canRequest = Boolean(b && b.approvalWorkflow && b.available.length > 0);

  return (
    <AccountScreen
      title={TITLE}
      subtitle={SUBTITLE}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        canRequest ? (
          <Button
            label="Request a service"
            onPress={() => {
              setNotice(null);
              setRequesting(Date.now());
            }}
            testID="service-request-open"
          />
        ) : undefined
      }
    >
      <View testID="services-screen" style={styles.body}>
        <ResultBanner result={notice} testID="service-result" />
        {b ? (
          <>
            {board.isError ? <StaleBanner failure={serviceFailure(board.error)} onRetry={() => void board.refetch()} /> : null}
            <Board b={b} onWithdraw={(card) => withdraw.mutate(card)} withdrawing={withdraw.isPending ? (withdraw.variables?.capabilityId ?? null) : null} />
          </>
        ) : board.isError ? (
          <LoadFailure title="Your services could not be loaded" failure={serviceFailure(board.error)} onRetry={() => void board.refetch()} testID="services-error" />
        ) : (
          <ListSkeleton cards={3} lines={2} label="Loading your services" />
        )}
      </View>
      {b && requesting !== null ? <RequestServiceSheet key={requesting} available={b.available} onClose={() => setRequesting(null)} onDone={setNotice} /> : null}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  gaps: { gap: space.md },
  gap: { gap: space.xs },
  available: { gap: space.sm },
  support: { marginTop: space.md },
});
