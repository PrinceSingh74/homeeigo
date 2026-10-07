import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Users } from "lucide-react-native";
import { useState } from "react";
import { Share, StyleSheet, View } from "react-native";
import { ProgressRow } from "@/components/HqUi";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { TapField } from "@/components/account/controls";
import { Button, Card, EmptyState, KeyValue, ListRow, Pill, T, formatRupees } from "@/components/ui";
import { useAuthed, usePullRefresh, useRewardsQuery } from "@/hooks/account/queries";
import { formatDate } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";

export function RewardsHubScreen() {
  const rewards = useRewardsQuery();
  const { refreshing, onRefresh } = usePullRefresh(rewards);
  const r = rewards.data;
  return (
    <AccountScreen title="Rewards" refreshing={refreshing} onRefresh={onRefresh}>
      {rewards.isLoading ? (
        <RowsSkeleton label="Loading rewards" />
      ) : !r ? (
        <ErrorState error={rewards.error} title="Rewards could not be loaded" onRetry={() => void rewards.refetch()} />
      ) : (
        <>
          <Card>
            <KeyValue label="Incentive earnings" value={formatRupees(r.incentiveEarnings)} strong />
            <KeyValue label="Badges earned" value={String(r.badges.length)} />
            <KeyValue label="Partners you referred" value={String(r.referralCount)} />
          </Card>
          <Card>
            <View style={styles.stack}>
              <T kind="heading" accessibilityRole="header">
                Milestones
              </T>
              {r.milestones.length === 0 ? (
                <T kind="small">No milestones are set right now.</T>
              ) : (
                r.milestones.map((m) => (
                  <View key={m.label}>
                    <ProgressRow label={m.label} pct={m.progressPct} />
                    <T kind="small" numeric>
                      {m.current} of {m.target}
                      {m.achieved ? " · achieved" : ""}
                    </T>
                  </View>
                ))
              )}
            </View>
          </Card>
        </>
      )}
    </AccountScreen>
  );
}

export function RewardsBadgesScreen() {
  const rewards = useRewardsQuery();
  const { refreshing, onRefresh } = usePullRefresh(rewards);
  const badges = rewards.data?.badges;
  return (
    <AccountScreen title="Badges" refreshing={refreshing} onRefresh={onRefresh}>
      {rewards.isLoading ? (
        <RowsSkeleton label="Loading badges" />
      ) : !badges ? (
        <ErrorState error={rewards.error} title="Badges could not be loaded" onRetry={() => void rewards.refetch()} />
      ) : badges.length === 0 ? (
        <EmptyState icon={Award} title="No badges yet" message="Badges you earn for your work appear here." />
      ) : (
        <Card>
          {badges.map((b, i) => (
            <ListRow key={b} title={b} icon={Award} last={i === badges.length - 1} />
          ))}
        </Card>
      )}
    </AccountScreen>
  );
}

const STATUS_WORDS: Record<string, string> = {
  INVITED: "Invited",
  REGISTERED: "Registered",
  VERIFIED: "Verified",
  TRAINING: "In training",
  ACTIVE: "Active",
  FIRST_JOB: "First job done",
  QUALIFIED: "Qualified",
  REWARD_RELEASED: "Reward released",
};

/** The partner-refers-partner programme. Every figure, the reward and the job target are the server's. */
export function RewardsReferralsScreen() {
  const qc = useQueryClient();
  const enabled = useAuthed();
  const network = useQuery({ queryKey: ["partner", "network"], queryFn: () => partnerApi.network.dashboard(), enabled });
  const { refreshing, onRefresh } = usePullRefresh(network);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [result, setResult] = useState<ActionResult>(null);
  const invite = useMutation({
    mutationFn: () => partnerApi.network.invite({ name: name.trim(), phone: phone.trim() }),
    onMutate: () => setResult(null),
    onSuccess: async (data) => {
      const invited = name.trim();
      setName("");
      setPhone("");
      await qc.invalidateQueries({ queryKey: ["partner", "network"] });
      setResult({ tone: "success", message: `${invited} is invited. The invite is open until ${formatDate(data.expiresAt)}.` });
    },
    onError: (e) => setResult(failure(e, "The invite could not be sent.")),
  });
  const nameOk = name.trim().length >= 2 && name.trim().length <= 120;
  const phoneOk = phone.trim().length >= 10 && phone.trim().length <= 20;
  const d = network.data;

  if (network.isLoading) {
    return (
      <AccountScreen title="Partner Network">
        <ListSkeleton label="Loading your partner network" />
      </AccountScreen>
    );
  }
  if (!d) {
    return (
      <AccountScreen title="Partner Network" refreshing={refreshing} onRefresh={onRefresh}>
        <ErrorState error={network.error} title="Your partner network could not be loaded" onRetry={() => void network.refetch()} />
      </AccountScreen>
    );
  }
  return (
    <AccountScreen title="Partner Network" subtitle={`Invite partners. You are rewarded ${formatRupees(d.rewardPerQualified)} when one you invited completes ${d.jobTarget} jobs and qualifies.`} refreshing={refreshing} onRefresh={onRefresh}>
      <Card>
        <KeyValue label="Your code" value={d.code} strong testID="referral-code" />
        <KeyValue label="Invited" value={String(d.counts.invited)} />
        <KeyValue label="Qualified" value={String(d.counts.qualified)} />
        <KeyValue label="Rewards paid to you" value={formatRupees(d.totalRewarded)} />
      </Card>
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Share link
          </T>
          <T kind="body" selectable testID="referral-share-url">
            {d.shareUrl}
          </T>
          <Button label="Share your link" variant="secondary" onPress={() => void Share.share({ message: d.shareUrl }).catch(() => undefined)} testID="referral-share" />
        </View>
      </Card>
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Invite someone
          </T>
          <TapField label="Full name" value={name} onChangeText={setName} autoComplete="name" maxLength={120} testID="referral-invite-name" />
          <TapField label="Mobile" value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" maxLength={20} help="At least 10 digits." testID="referral-invite-phone" />
          <ResultBanner result={result} testID="referral-invite-result" />
          <Button label="Send invite" onPress={() => invite.mutate()} loading={invite.isPending} disabled={!nameOk || !phoneOk} hint={!nameOk || !phoneOk ? "Enter a name and a mobile number first." : null} testID="referral-invite-send" />
        </View>
      </Card>
      {d.referrals.length === 0 ? (
        <EmptyState icon={Users} title="No referrals yet" message="People you invite appear here with their progress. Share your code or send an invite." />
      ) : (
        <Card>
          <View style={styles.stack}>
            <T kind="heading" accessibilityRole="header">
              Your referrals
            </T>
            {d.referrals.map((r) => (
              <View key={r.id} style={styles.referral} testID={`referral-${r.id}`}>
                <View style={styles.head}>
                  <T kind="bodyStrong" style={styles.flex}>
                    {r.name}
                  </T>
                  <Pill label={r.qualificationLabel} tone={r.qualificationLabel === "Rewarded" || r.qualificationLabel === "Qualified" ? "success" : r.qualificationLabel === "Eligible" ? "info" : "neutral"} />
                </View>
                <T kind="small" numeric>
                  {STATUS_WORDS[r.status] ?? r.status.replace(/_/g, " ")} · {r.jobs}/{r.jobTarget} jobs
                  {typeof r.rewardAmount === "number" ? ` · ${formatRupees(r.rewardAmount)} paid` : ""}
                </T>
                {r.nextMilestone ? <T kind="small">{r.nextMilestone}</T> : null}
              </View>
            ))}
          </View>
        </Card>
      )}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1 },
  referral: { gap: 2 },
});
