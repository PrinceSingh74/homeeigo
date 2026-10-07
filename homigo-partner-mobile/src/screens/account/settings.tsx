import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SwitchRow } from "@/components/account/controls";
import { AccountScreen, ErrorState, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { Button, Card, Field, KeyValue, T } from "@/components/ui";
import { useProviderQuery, usePullRefresh, useUserProfileQuery } from "@/hooks/account/queries";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerUserProfile } from "@/types/partner";

type ChannelFlag = "notificationsEnabled" | "pushNotifications" | "emailNotifications" | "smsNotifications";

const CHANNELS: ReadonlyArray<{ key: ChannelFlag; label: string; help: string }> = [
  { key: "notificationsEnabled", label: "Notifications", help: "The main switch for messages that are not required." },
  { key: "pushNotifications", label: "Push notifications", help: "Alerts on this phone." },
  { key: "emailNotifications", label: "Email", help: "Messages to your email address." },
  { key: "smsNotifications", label: "SMS", help: "Text messages to your phone number." },
];

/** `PUT /api/users/preferences`: one flag per request; a refusal is shown and the switch stays where the server has it. */
function PreferencesCard({ profile }: { profile: PartnerUserProfile }) {
  const qc = useQueryClient();
  const [result, setResult] = useState<ActionResult>(null);
  const save = useMutation({
    mutationFn: (input: { key: ChannelFlag; value: boolean }) => partnerApi.updatePreferences({ [input.key]: input.value }),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner", "user-profile"] });
      void qc.invalidateQueries({ queryKey: ["partner", "notification-preferences"] });
    },
    onError: (e) => setResult(failure(e, "That preference could not be changed.")),
  });
  return (
    <Card testID="settings-preferences">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header">
          How we may contact you
        </T>
        <T kind="small">Job, payment and security messages are always delivered, whatever is chosen here.</T>
        {CHANNELS.map((c) => (
          <SwitchRow
            key={c.key}
            testID={`settings-pref-${c.key}`}
            label={c.label}
            help={c.help}
            value={Boolean(profile[c.key])}
            busy={save.isPending && save.variables?.key === c.key}
            disabled={save.isPending}
            onChange={(value) => save.mutate({ key: c.key, value })}
          />
        ))}
        <KeyValue label="Language" value={profile.preferredLanguage || "—"} />
        <ResultBanner result={result} testID="settings-pref-error" />
      </View>
    </Card>
  );
}

/** The partner's public bio (`PUT /api/providers/me/settings`, `bio` only — nothing else is sent with it). */
function BioCard({ bio }: { bio: string | null }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(bio ?? "");
  const [result, setResult] = useState<ActionResult>(null);
  useEffect(() => setDraft(bio ?? ""), [bio]);
  const save = useMutation({
    mutationFn: () => partnerApi.updateSettings({ bio: draft.trim() }),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner", "provider"] });
      setResult({ tone: "success", message: "Your bio was saved." });
    },
    onError: (e) => setResult(failure(e, "Your bio could not be saved.")),
  });
  return (
    <Card testID="settings-bio">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header">
          About your work
        </T>
        <Field label="Bio shown to customers" value={draft} onChangeText={setDraft} multiline maxLength={2000} help="Your experience and what you do best. Up to 2,000 characters." testID="settings-bio-input" />
        <Button label="Save bio" variant="secondary" onPress={() => save.mutate()} loading={save.isPending} disabled={draft.trim() === (bio ?? "")} testID="settings-bio-save" />
        <ResultBanner result={result} testID="settings-bio-result" />
      </View>
    </Card>
  );
}

export function AccountSettingsScreen() {
  const provider = useProviderQuery();
  const profile = useUserProfileQuery();
  const { refreshing, onRefresh } = usePullRefresh(provider, profile);
  const p = provider.data;
  return (
    <AccountScreen title="Settings" refreshing={refreshing} onRefresh={onRefresh}>
      {profile.isLoading ? (
        <RowsSkeleton label="Loading your preferences" />
      ) : profile.data ? (
        <PreferencesCard profile={profile.data} />
      ) : (
        <Card>
          <ErrorState error={profile.error} title="Your preferences could not be loaded" onRetry={() => void profile.refetch()} />
        </Card>
      )}

      {provider.isLoading ? (
        <RowsSkeleton label="Loading your settings" />
      ) : !p ? (
        <Card>
          <ErrorState error={provider.error} title="Your settings could not be loaded" onRetry={() => void provider.refetch()} />
        </Card>
      ) : (
        <>
          <BioCard bio={p.bio} />
          <Card>
            <View style={styles.stack}>
              <T kind="heading" accessibilityRole="header">
                Working hours
              </T>
              <KeyValue label="Hours" value={p.workingHoursStart && p.workingHoursEnd ? `${p.workingHoursStart} to ${p.workingHoursEnd}` : "Not set"} />
              <KeyValue label="Days" value={p.workingDays.length ? p.workingDays.join(", ") : "Not set"} />
              <Button label="Change in availability" variant="secondary" onPress={() => router.push("/hq/account-availability")} testID="settings-open-availability" />
            </View>
          </Card>
          {/*
            No "payout preference" card: the server stores `paymentMethodPreference` and `upiId` on
            the provider row, but no payout reads them — a withdrawal is paid to the bank account
            typed into the withdraw form (POST /api/wallet/withdraw has no UPI field).
          */}
        </>
      )}
      <Button label="Password and signed-in devices" variant="secondary" onPress={() => router.push("/hq/account-profile")} testID="settings-open-security" />
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
});
