import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Award, GraduationCap } from "lucide-react-native";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { Button, Card, EmptyState, KeyValue, ListRow, Pill, T } from "@/components/ui";
import { useAcademyQuery, useProviderQuery, usePullRefresh } from "@/hooks/account/queries";
import { formatDate } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";

/** Training modules. "Mark complete" is the partner's own statement; the server records it. */
export function AcademyTrainingScreen() {
  const qc = useQueryClient();
  const academy = useAcademyQuery();
  const { refreshing, onRefresh } = usePullRefresh(academy);
  const [result, setResult] = useState<ActionResult>(null);
  const [open, setOpen] = useState<string | null>(null);
  const complete = useMutation({
    mutationFn: (moduleId: string) => partnerApi.partnerOs.completeAcademyModule(moduleId),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner", "academy"] });
      setResult({ tone: "success", message: "Module marked complete." });
    },
    onError: (e) => setResult(failure(e, "The module could not be marked complete.")),
  });
  const a = academy.data;
  return (
    <AccountScreen title="Training" refreshing={refreshing} onRefresh={onRefresh}>
      {academy.isLoading ? (
        <ListSkeleton label="Loading training modules" />
      ) : !a ? (
        <ErrorState error={academy.error} title="Training could not be loaded" onRetry={() => void academy.refetch()} />
      ) : a.modules.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No training modules yet" message="Modules assigned to partners appear here. There is nothing to complete right now." />
      ) : (
        <>
          <Card>
            <KeyValue label="Modules completed" value={`${a.completedCount} of ${a.modules.length}`} strong />
          </Card>
          <ResultBanner result={result} testID="academy-result" />
          {a.modules.map((m) => {
            const expanded = open === m.id;
            const long = (m.body?.length ?? 0) > 220;
            return (
              <Card key={m.id} testID={`academy-module-${m.id}`}>
                <View style={styles.stack}>
                  <View style={styles.head}>
                    <T kind="heading" style={styles.flex}>
                      {m.title}
                    </T>
                    <Pill label={m.completedAt ? "Completed" : "Not completed"} tone={m.completedAt ? "success" : "neutral"} />
                  </View>
                  <T kind="small">
                    {m.contentType}
                    {m.completedAt ? ` · completed ${formatDate(m.completedAt)}` : ""}
                    {typeof m.score === "number" ? ` · score ${m.score}` : ""}
                  </T>
                  {m.body ? <T kind="body">{expanded || !long ? m.body : `${m.body.slice(0, 220)}…`}</T> : null}
                  {long ? <Button label={expanded ? "Show less" : "Read all"} variant="quiet" onPress={() => setOpen(expanded ? null : m.id)} accessibilityLabel={`${expanded ? "Show less of" : "Read all of"} ${m.title}`} /> : null}
                  {m.contentUrl ? <Button label="Open training material" variant="secondary" onPress={() => void Linking.openURL(m.contentUrl!)} accessibilityLabel={`Open training material for ${m.title}`} /> : null}
                  {!m.completedAt ? (
                    <Button
                      label="Mark complete"
                      variant="secondary"
                      accessibilityLabel={`Mark ${m.title} complete`}
                      onPress={() => complete.mutate(m.id)}
                      loading={complete.isPending && complete.variables === m.id}
                      disabled={complete.isPending}
                      testID={`academy-complete-${m.id}`}
                    />
                  ) : null}
                </View>
              </Card>
            );
          })}
        </>
      )}
    </AccountScreen>
  );
}

/**
 * Certifications as the server lists them: names only. The server sends no status for these, so
 * none is shown (the old screen labelled every one "Verified"). Verified credentials live on
 * "My credentials", where each row carries its real status.
 */
export function AcademyCertificationsScreen() {
  const academy = useAcademyQuery();
  const provider = useProviderQuery();
  const { refreshing, onRefresh } = usePullRefresh(academy, provider);
  const loading = academy.isLoading || provider.isLoading;
  const failed = !academy.data && !provider.data ? (academy.error ?? provider.error) : null;
  const names = [...new Set([...(academy.data?.certifications ?? []), ...(provider.data?.certifications ?? [])])];
  return (
    <AccountScreen title="Certifications" refreshing={refreshing} onRefresh={onRefresh}>
      {loading ? (
        <RowsSkeleton label="Loading certifications" />
      ) : failed ? (
        <ErrorState error={failed} title="Certifications could not be loaded" onRetry={onRefresh} />
      ) : names.length === 0 ? (
        <EmptyState icon={Award} title="No certifications recorded" message="Certifications recorded on your profile appear here. Declare one under My credentials." />
      ) : (
        <Card>
          {names.map((name, i) => (
            <ListRow key={name} title={name} icon={Award} last={i === names.length - 1} />
          ))}
        </Card>
      )}
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            My credentials
          </T>
          <T kind="small">Verified credentials make a professional eligible for jobs that require them.</T>
          <Button label="Manage my credentials" variant="secondary" onPress={() => router.push("/hq/academy-credentials")} testID="open-my-credentials" />
        </View>
      </Card>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  flex: { flex: 1 },
});
