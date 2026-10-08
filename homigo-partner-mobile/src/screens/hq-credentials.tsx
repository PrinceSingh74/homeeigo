import { Hourglass } from "lucide-react-native";
import { useState } from "react";
import { View, StyleSheet } from "react-native";
import { AccountScreen, ListSkeleton, ResultBanner, RowsSkeleton, type ActionResult } from "@/components/account/states";
import { Group, LoadFailure, StaleBanner, StatusRow } from "@/components/credentials/parts";
import { AddCredentialSheet, CredentialDetailSheet, type DatedTarget } from "@/components/credentials/sheets";
import { Button, Card, EmptyState, KeyValue, T } from "@/components/ui";
import { usePullRefresh } from "@/hooks/account/queries";
import { useCapabilityProfileQuery } from "@/hooks/credentials/queries";
import { CAPABILITY_NOT_DEPLOYED } from "@/lib/capabilities";
import { capabilityFailure, datedRowView, equipmentRowView, languageRowView, pendingReviewLabel, skillRowView, type CredentialRowView } from "@/lib/credentials-screen";
import { errorCode } from "@/lib/error-sentence";
import { formatDate } from "@/lib/format";
import { space } from "@/theme/tokens";
import type { PartnerCapabilityProfile, ProviderEquipmentView } from "@/types/partner";

/**
 * "My credentials": the partner's own skills, certifications, equipment, insurance and languages
 * (`GET /api/providers/me/capabilities`). The partner declares; an administrator verifies; a verified
 * credential is locked. Every status, validity and near-expiry flag on this screen is the server's —
 * the pure mirrors in `lib/capabilities.ts` only decide which actions a row offers, and the server's
 * refusal (409 `CAPABILITY_LOCKED` and the rest) is always shown as it arrives.
 *
 * One primary action, docked: "Add a credential". A row opens its details, where the actions its
 * state allows live.
 */

const TITLE = "My credentials";
const SUBTITLE = "Verified credentials make a professional eligible for jobs that require them.";

type Selected = { view: CredentialRowView; equipment?: ProviderEquipmentView; dated?: DatedTarget };

function Rows({ kind, items, onOpen }: { kind: string; items: Selected[]; onOpen: (s: Selected) => void }) {
  return (
    <>
      {items.map((s, i) => (
        <StatusRow
          key={s.view.id}
          testID={`credential-${kind}-${s.view.id}`}
          title={s.view.title}
          pills={[s.view.pill, s.view.attention]}
          subtitle={s.view.subtitle}
          onPress={() => onOpen(s)}
          last={i === items.length - 1}
        />
      ))}
    </>
  );
}

function Profile({ p, onOpen }: { p: PartnerCapabilityProfile; onOpen: (s: Selected) => void }) {
  const now = new Date();
  const catalogue = p.requirementCatalogue;
  const skills = p.skills.map((r) => ({ view: skillRowView(r, now, formatDate) }));
  const certifications = p.certifications.map((r) => ({ view: datedRowView("certifications", r, catalogue, now, formatDate), dated: { kind: "certifications" as const, row: r, catalogue } }));
  const equipment = p.equipment.map((r) => ({ view: equipmentRowView(r, catalogue, formatDate), equipment: r }));
  const insurance = p.insurance.map((r) => ({ view: datedRowView("insurance", r, catalogue, now, formatDate), dated: { kind: "insurance" as const, row: r, catalogue } }));
  const languages = p.languages.map((r) => ({ view: languageRowView(r) }));
  return (
    <>
      <Card>
        <KeyValue label={pendingReviewLabel(p.services as ReadonlyArray<{ status?: unknown }>)} value={String(p.summary.pendingReview)} />
        <KeyValue label="Expiring or due within 30 days" value={String(p.summary.nearExpiry)} />
        <KeyValue label="Expired or overdue" value={String(p.summary.expired)} />
      </Card>
      <T kind="small">You add a credential; the Homeeigo team reviews it. Once verified it is locked and counts towards the jobs you can be offered.</T>

      <Group testID="credentials-skills" title="Skills" isEmpty={skills.length === 0} empty="No skills yet. The skills you add appear here with their review status. Use Add a credential below.">
        <Rows kind="skills" items={skills} onOpen={onOpen} />
      </Group>
      <Group testID="credentials-certifications" title="Certifications" isEmpty={certifications.length === 0} empty="No certifications yet. Certificates and licences you add appear here with their status and expiry. Use Add a credential below.">
        <Rows kind="certifications" items={certifications} onOpen={onOpen} />
      </Group>
      <Group testID="credentials-equipment" title="Equipment" isEmpty={equipment.length === 0} empty="No equipment yet. Equipment you add appears here with its status and whether it is working. Use Add a credential below.">
        <Rows kind="equipment" items={equipment} onOpen={onOpen} />
      </Group>
      <Group testID="credentials-insurance" title="Insurance" isEmpty={insurance.length === 0} empty="No insurance yet. Policies you add appear here with their status and expiry. Use Add a credential below.">
        <Rows kind="insurance" items={insurance} onOpen={onOpen} />
      </Group>
      <Group testID="credentials-languages" title="Languages" isEmpty={languages.length === 0} empty="No languages yet. The languages you speak appear here. Use Add a credential below.">
        <Rows kind="languages" items={languages} onOpen={onOpen} />
      </Group>
    </>
  );
}

export function MyCredentialsScreen() {
  const profile = useCapabilityProfileQuery();
  const { refreshing, onRefresh } = usePullRefresh(profile);
  const [adding, setAdding] = useState<number | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [result, setResult] = useState<ActionResult>(null);
  const p = profile.data;
  const done = (message: string) => setResult({ tone: "success", message });
  const open = (s: Selected) => {
    setResult(null);
    setSelected(s);
  };

  return (
    <AccountScreen
      title={TITLE}
      subtitle={SUBTITLE}
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        p ? (
          <Button
            label="Add a credential"
            onPress={() => {
              setResult(null);
              setAdding(Date.now());
            }}
            testID="credential-add-open"
          />
        ) : undefined
      }
    >
      <View testID="credentials-screen" style={styles.body}>
        <ResultBanner result={result} testID="credential-result" />
        {p ? (
          <>
            {profile.isError ? <StaleBanner failure={capabilityFailure(profile.error)} onRetry={() => void profile.refetch()} /> : null}
            <Profile p={p} onOpen={open} />
          </>
        ) : profile.isError ? (
          errorCode(profile.error) === CAPABILITY_NOT_DEPLOYED ? (
            <Card testID="credentials-coming-soon">
              <EmptyState icon={Hourglass} title="Coming soon" message="Credentials are not switched on yet." />
            </Card>
          ) : (
            <LoadFailure title="Your credentials could not be loaded" failure={capabilityFailure(profile.error)} onRetry={() => void profile.refetch()} testID="credentials-error" />
          )
        ) : (
          <>
            <RowsSkeleton rows={3} label="Loading your credentials" />
            <ListSkeleton cards={2} lines={2} label="Loading your credentials" />
          </>
        )}
      </View>
      {p && adding !== null ? <AddCredentialSheet key={adding} profile={p} onClose={() => setAdding(null)} onDone={done} /> : null}
      {selected ? (
        <CredentialDetailSheet
          key={`${selected.view.kind}-${selected.view.id}`}
          view={selected.view}
          equipment={selected.equipment}
          dated={selected.dated}
          onClose={() => setSelected(null)}
          onDone={done}
        />
      ) : null}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
});
