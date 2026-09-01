import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { KpiCard } from "@/components/KpiCard";
import { EmptyState, HqCard, HqCardTitle, HqMuted, LoadingBlock, ProgressRow, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { formatCurrency, formatDate, formatPct } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { getJobCoords } from "@/lib/job-coords";
import { useAuthStore } from "@/stores/auth-store";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { OnlineToggleCard, useDashboardQuery, useProviderQuery } from "@/screens/hq-work-earnings";
import { AvailabilityWorkspaceScreen } from "@/screens/availability-workspace";
import { partnerColors } from "@/theme/colors";

function useAuthedQuery() {
  return useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
}

function HqShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <PartnerScreen title={title} subtitle={subtitle} showBack>
      {children}
    </PartnerScreen>
  );
}

export function AcademyTrainingScreen() {
  const qc = useQueryClient();
  const academy = useQuery({ queryKey: ["partner", "academy"], queryFn: () => partnerApi.partnerOs.academy() });
  const complete = useMutation({
    mutationFn: (moduleId: string) => partnerApi.partnerOs.completeAcademyModule(moduleId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["partner", "academy"] }),
  });
  if (academy.isLoading) return <HqShell title="Training" subtitle="Academy modules"><LoadingBlock /></HqShell>;
  const a = academy.data!;
  return (
    <HqShell title="Partner Academy" subtitle="Training modules — mark complete when finished.">
      <KpiCard label="Completed" value={`${a.completedCount}/${a.modules.length}`} />
      <HqCard>
        {a.modules.map((m) => (
          <View key={m.id} style={styles.module}>
            <Text style={styles.moduleTitle}>{m.title}</Text>
            <Text style={styles.moduleMeta}>{m.contentType}{m.completedAt ? ` · Done ${formatDate(m.completedAt)}` : ""}</Text>
            {m.body ? <Text style={styles.moduleBody}>{m.body.slice(0, 200)}{m.body.length > 200 ? "…" : ""}</Text> : null}
            {!m.completedAt ? (
              <Pressable onPress={() => complete.mutate(m.id)} style={styles.smallBtn}>
                <Text style={styles.smallBtnText}>Mark complete</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AcademyCertificationsScreen() {
  const academy = useQuery({ queryKey: ["partner", "academy"], queryFn: () => partnerApi.partnerOs.academy() });
  const provider = useProviderQuery();
  if (academy.isLoading) return <HqShell title="Certifications" subtitle="Earned certs"><LoadingBlock /></HqShell>;
  const certs = [...(academy.data?.certifications ?? []), ...(provider.data?.certifications ?? [])];
  const unique = [...new Set(certs)];
  return (
    <HqShell title="Certifications" subtitle="Provider certifications list.">
      <HqCard>
        {unique.length === 0 ? (
          <EmptyState message="No certifications yet. Complete academy modules to earn badges." />
        ) : (
          unique.map((c) => <StatRow key={c} label={c} value="Verified" />)
        )}
      </HqCard>
    </HqShell>
  );
}

export function TrustDocumentsScreen() {
  const enabled = useAuthedQuery();
  const docs = useQuery({
    queryKey: ["partner", "documents"],
    queryFn: () => partnerApi.partnerOs.documents(),
    enabled,
  });
  if (docs.isLoading || docs.isPending) return <HqShell title="Documents" subtitle="Uploaded docs"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Documents" subtitle="Uploaded documents overview.">
      <HqCard>
        {(docs.data?.documents ?? []).length === 0 ? (
          <EmptyState message="No documents uploaded." />
        ) : (
          docs.data!.documents.map((d) => (
            <StatRow key={d.id} label={d.documentName || d.documentType} value={d.isVerified ? "Verified" : "Pending"} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function TrustVerificationScreen() {
  const compliance = useQuery({ queryKey: ["partner", "compliance"], queryFn: () => partnerApi.partnerOs.compliance() });
  const provider = useProviderQuery();
  if (compliance.isLoading) return <HqShell title="Verification" subtitle="KYC status"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Verification" subtitle="KYC and background verification status.">
      <HqCard>
        <StatRow label="KYC status" value={provider.data?.kycStatus ?? "—"} />
        <StatRow label="Background check" value={provider.data?.backgroundCheckStatus ?? "—"} />
        <StatRow label="Email verified" value={provider.data?.isVerified ? "Yes" : "Pending"} />
        <StatRow label="Approved partner" value={provider.data?.isApproved ? "Yes" : "Pending"} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Verification record</HqCardTitle>
        {Object.entries(compliance.data?.verification ?? {}).map(([k, v]) => (
          <StatRow key={k} label={k} value={String(v)} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function TrustComplianceScreen() {
  const enabled = useAuthedQuery();
  const compliance = useQuery({
    queryKey: ["partner", "compliance"],
    queryFn: () => partnerApi.partnerOs.compliance(),
    enabled,
  });
  if (compliance.isLoading || compliance.isPending) {
    return <HqShell title="Compliance" subtitle="Score and expiry"><LoadingBlock /></HqShell>;
  }
  const c = compliance.data;
  if (!c) {
    return (
      <HqShell title="Compliance Center" subtitle="Could not load compliance.">
        <EmptyState message={compliance.error instanceof Error ? compliance.error.message : "Try again from HQ."} />
      </HqShell>
    );
  }
  const kyc = String(c.verification?.kycStatus ?? c.verification?.isVerified ?? "—");
  const nextAction =
    (c.documents ?? []).find((d) => d.cta && d.cta !== "OK")?.cta ??
    (c.restricted ? "Resolve restriction with operations" : "No action required");
  return (
    <HqShell title="Compliance Center" subtitle={c.explanation ?? "KYC, documents, and expiry."}>
      <View style={styles.grid} accessibilityLabel="Compliance status summary">
        <KpiCard label="Status" value={(c.status ?? "PENDING").replace(/_/g, " ")} />
        <KpiCard label="Restriction" value={c.restricted ? "Restricted" : "In good standing"} />
        <KpiCard label="Expiring" value={c.expiringSoon} />
      </View>
      <HqCard>
        <HqCardTitle>KYC</HqCardTitle>
        <StatRow label="KYC status" value={String(kyc)} />
        <StatRow label="Next action" value={nextAction} />
        {c.restricted && c.restrictionReason ? <StatRow label="Restriction" value={c.restrictionReason} /> : null}
      </HqCard>
      <HqCard>
        <HqCardTitle>Documents</HqCardTitle>
        {(c.documents ?? []).map((d) => (
          <StatRow
            key={d.id}
            label={d.documentName || d.documentType}
            value={d.expiryState || d.cta || (d.expiringSoon ? "Expiring soon" : d.isVerified ? "Verified" : "Pending")}
          />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function RewardsHubScreen() {
  const rewards = useQuery({ queryKey: ["partner", "rewards"], queryFn: () => partnerApi.partnerOs.rewards() });
  if (rewards.isLoading) return <HqShell title="Rewards" subtitle="Badges and milestones"><LoadingBlock /></HqShell>;
  const r = rewards.data!;
  return (
    <HqShell title="Rewards HQ" subtitle="Badges, milestones, and incentive earnings.">
      <View style={styles.grid}>
        <KpiCard label="Badges" value={r.badges.length} />
        <KpiCard label="Referrals" value={r.referralCount} />
        <KpiCard label="Incentive earnings" value={formatCurrency(r.incentiveEarnings)} />
      </View>
      <HqCard>
        <HqCardTitle>Milestones</HqCardTitle>
        {r.milestones.map((m) => (
          <ProgressRow key={m.label} label={m.label} pct={m.progressPct} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function RewardsBadgesScreen() {
  const rewards = useQuery({ queryKey: ["partner", "rewards"], queryFn: () => partnerApi.partnerOs.rewards() });
  if (rewards.isLoading) return <HqShell title="Badges" subtitle="Achievements"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Badges" subtitle="Achievement badges earned.">
      <HqCard>
        {(rewards.data?.badges ?? []).length === 0 ? (
          <EmptyState message="No badges earned yet." />
        ) : (
          rewards.data!.badges.map((b) => <StatRow key={b} label={b} value="Earned" />)
        )}
      </HqCard>
    </HqShell>
  );
}

export function RewardsReferralsScreen() {
  const network = useQuery({
    queryKey: ["partner", "network"],
    queryFn: () => partnerApi.network.dashboard(),
  });
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => partnerApi.network.invite({ name: name.trim(), phone: phone.trim() }),
    onSuccess: () => {
      setName("");
      setPhone("");
      setFormError(null);
      void qc.invalidateQueries({ queryKey: ["partner", "network"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Could not send invite"),
  });
  if (network.isLoading) return <HqShell title="Referrals" subtitle="Partner network"><LoadingBlock /></HqShell>;
  if (network.isError) {
    return (
      <HqShell title="Referrals" subtitle="Partner network">
        <EmptyState message="Could not load your partner network." />
        <Pressable
          onPress={() => void network.refetch()}
          style={styles.outlineBtn}
          accessibilityRole="button"
          accessibilityLabel="Retry"
        >
          <Text style={styles.outlineBtnText}>Retry</Text>
        </Pressable>
      </HqShell>
    );
  }
  const d = network.data!;
  return (
    <HqShell title="Partner Network" subtitle="Invite partners. Reward after 3 successful jobs and trust gates.">
      <View style={styles.grid}>
        <KpiCard label="Code" value={d.code} />
        <KpiCard label="Invited" value={d.counts.invited ?? 0} />
        <KpiCard label="Qualified" value={d.counts.qualified ?? 0} />
        <KpiCard label="Rewards" value={formatCurrency(d.totalRewarded)} />
      </View>
      <HqCard>
        <HqCardTitle>Share link</HqCardTitle>
        <HqMuted>{d.shareUrl}</HqMuted>
      </HqCard>
      <HqCard>
        <HqCardTitle>Invite someone</HqCardTitle>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          accessibilityLabel="Full name"
          style={styles.inviteInput}
          autoComplete="name"
        />
        <TextInput
          value={phone}
          onChangeText={setPhone}
          placeholder="Mobile"
          accessibilityLabel="Mobile"
          keyboardType="phone-pad"
          style={styles.inviteInput}
          autoComplete="tel"
        />
        {formError ? <Text style={styles.moduleMeta}>{formError}</Text> : null}
        <Pressable
          onPress={() => invite.mutate()}
          disabled={invite.isPending || name.trim().length < 2 || phone.trim().length < 10}
          style={styles.smallBtn}
          accessibilityRole="button"
          accessibilityLabel="Send invite"
        >
          <Text style={styles.smallBtnText}>{invite.isPending ? "Sending…" : "Send invite"}</Text>
        </Pressable>
      </HqCard>
      {(d.referrals ?? []).length === 0 ? (
        <EmptyState message="No referrals yet. Share your code to invite partners." />
      ) : (
        <HqCard>
          <HqCardTitle>Your referrals</HqCardTitle>
          {d.referrals.map((r) => (
            <View key={r.id} style={styles.module}>
              <StatRow
                label={`${r.name} · ${r.status.replace(/_/g, " ")}`}
                value={`${r.jobs}/${r.jobTarget} · ${r.qualificationLabel}`}
              />
              <Text style={styles.moduleBody}>{r.nextMilestone}</Text>
            </View>
          ))}
        </HqCard>
      )}
    </HqShell>
  );
}

export function WellbeingInsuranceScreen() {
  const wellbeing = useQuery({ queryKey: ["partner", "wellbeing"], queryFn: () => partnerApi.partnerOs.wellbeing() });
  if (wellbeing.isLoading) return <HqShell title="Insurance" subtitle="Partner insurance"><LoadingBlock /></HqShell>;
  const url = wellbeing.data?.insuranceUrl;
  return (
    <HqShell title="Insurance" subtitle="Partner insurance portal.">
      <HqCard>
        {url ? (
          <Pressable onPress={() => void Linking.openURL(url)} style={styles.linkBtn}>
            <Text style={styles.linkBtnText}>Open insurance portal</Text>
          </Pressable>
        ) : (
          <EmptyState message="Insurance portal link not configured yet." />
        )}
      </HqCard>
    </HqShell>
  );
}

export function WellbeingSosScreen() {
  const enabled = useAuthedQuery();
  const wellbeing = useQuery({
    queryKey: ["partner", "wellbeing"],
    queryFn: () => partnerApi.partnerOs.wellbeing(),
    enabled,
  });
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const sos = useMutation({
    mutationFn: async () => {
      const coords = await getJobCoords("strict");
      return partnerApi.partnerOs.triggerSos({ latitude: coords.latitude, longitude: coords.longitude });
    },
    onSuccess: (data) => {
      setMsg(data.created ? "SOS sent to operations." : "SOS already active.");
      setArmed(false);
    },
    onError: (err) =>
      setMsg(err instanceof Error ? err.message : "Could not reach operations. Call the hotline."),
  });
  const phone = wellbeing.data?.sosPhone ?? "112";
  const emName = wellbeing.data?.emergencyContactName;
  const emPhone = wellbeing.data?.emergencyContactPhone;
  return (
    <HqShell title="SOS" subtitle="Hold to arm, then confirm. Operations is notified once.">
      <HqCard>
        <HqCardTitle>Emergency contact</HqCardTitle>
        {wellbeing.isLoading && !wellbeing.data ? (
          <LoadingBlock />
        ) : (
          <Text style={styles.sosText}>{emName ? `${emName}${emPhone ? ` · ${emPhone}` : ""}` : "Add an emergency contact during onboarding or from this screen."}</Text>
        )}
        {emPhone ? (
          <Pressable onPress={() => void Linking.openURL(`tel:${emPhone}`)} style={styles.outlineBtn} accessibilityRole="button" accessibilityLabel="Call emergency contact">
            <Text style={styles.outlineBtnText}>Call emergency contact</Text>
          </Pressable>
        ) : null}
      </HqCard>
      <HqCard>
        <Text style={styles.sosText}>In an emergency, call the hotline and confirm SOS so operations receives your location.</Text>
        <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)} style={styles.outlineBtn} accessibilityRole="button" accessibilityLabel={`Call ${phone}`}>
          <Text style={styles.outlineBtnText}>Call {phone}</Text>
        </Pressable>
        {!armed ? (
          <Pressable
            testID="sos-arm"
            accessibilityRole="button"
            accessibilityLabel="Hold to activate SOS"
            onLongPress={() => setArmed(true)}
            delayLongPress={600}
            style={styles.sosBtn}
          >
            <Text style={styles.sosBtnText}>Hold to activate SOS</Text>
          </Pressable>
        ) : (
          <View>
            <Text style={styles.sosText}>Confirm emergency? This alerts operations once.</Text>
            <Pressable testID="sos-confirm" accessibilityRole="button" accessibilityLabel="Confirm emergency" onPress={() => sos.mutate()} style={styles.sosBtn}>
              <Text style={styles.sosBtnText}>{sos.isPending ? "Sending…" : "Confirm emergency"}</Text>
            </Pressable>
            <Pressable onPress={() => setArmed(false)} style={styles.outlineBtn}>
              <Text style={styles.outlineBtnText}>Cancel</Text>
            </Pressable>
          </View>
        )}
        {msg ? <Text style={styles.sosText}>{msg}</Text> : null}
      </HqCard>
    </HqShell>
  );
}

export function WellbeingCommunityScreen() {
  const wellbeing = useQuery({ queryKey: ["partner", "wellbeing"], queryFn: () => partnerApi.partnerOs.wellbeing() });
  const notifications = useQuery({
    queryKey: ["partner", "notifications", "community"],
    queryFn: () => partnerApi.notifications.list({ limit: 10 }),
  });
  if (wellbeing.isLoading) return <HqShell title="Community" subtitle="Announcements"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Community" subtitle="Partner community and announcements.">
      {wellbeing.data?.communityUrl ? (
        <Pressable onPress={() => void Linking.openURL(wellbeing.data!.communityUrl!)} style={styles.linkBtn}>
          <Text style={styles.linkBtnText}>Open community</Text>
        </Pressable>
      ) : null}
      <HqCard>
        <HqCardTitle>Announcements</HqCardTitle>
        {(notifications.data?.notifications ?? []).length === 0 ? (
          <EmptyState message="No announcements yet." />
        ) : (
          notifications.data!.notifications.map((n) => (
            <StatRow key={n.id} label={n.title} value={formatDate(n.createdAt)} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function AccountProfileScreen() {
  const provider = useProviderQuery();
  const dashboard = useDashboardQuery();
  if (provider.isLoading) return <HqShell title="Profile" subtitle="Business info"><LoadingBlock /></HqShell>;
  const p = provider.data!;
  return (
    <HqShell title="Profile" subtitle="Business info, services, verification, and stats.">
      <HqCard>
        <StatRow label="Name" value={p.name} />
        <StatRow label="Email" value={p.email} />
        <StatRow label="Phone" value={p.phoneNumber ?? "—"} />
        <StatRow label="City" value={p.city ?? "—"} />
        <StatRow label="Bio" value={p.bio ?? "—"} />
        <StatRow label="Rating" value={`${p.rating.toFixed(1)} (${p.totalReviews} reviews)`} />
        <StatRow label="Jobs done" value={p.completedBookings} />
        <StatRow label="Total earnings" value={formatCurrency(p.totalEarnings)} />
        <StatRow label="KYC" value={p.kycStatus} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Services</HqCardTitle>
        {p.services.map((s) => (
          <StatRow key={s.id} label={s.name} value="Active" />
        ))}
      </HqCard>
      {dashboard.data ? (
        <HqCard>
          <HqCardTitle>Performance snapshot</HqCardTitle>
          <StatRow label="Acceptance" value={formatPct(dashboard.data.rates.acceptanceRate)} />
          <StatRow label="Completion" value={formatPct(dashboard.data.rates.completionRate)} />
        </HqCard>
      ) : null}
    </HqShell>
  );
}

export function AccountNotificationsScreen() {
  const qc = useQueryClient();
  const notifications = useQuery({ queryKey: ["partner", "notifications"], queryFn: () => partnerApi.notifications.list({ limit: 30 }) });
  const prefs = useQuery({
    queryKey: ["partner", "notification-preferences"],
    queryFn: () => partnerApi.notifications.preferences(),
    staleTime: 60_000,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => partnerApi.notifications.markRead(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["partner", "notifications"] }),
  });
  const setPreference = useMutation({
    mutationFn: (input: {
      channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS";
      category: "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";
      enabled: boolean;
    }) => partnerApi.notifications.setPreference(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["partner", "notification-preferences"] }),
  });
  if (notifications.isLoading) return <HqShell title="Notifications" subtitle="Alerts"><LoadingBlock /></HqShell>;
  const optionalCells = (prefs.data?.matrix ?? []).filter((c) => c.category === "OPTIONAL");
  const CHANNEL_LABEL = { IN_APP: "In-app", PUSH: "Push", EMAIL: "Email", SMS: "SMS" } as const;
  return (
    <HqShell title="Notifications" subtitle="List, mark read, and manage alerts.">
      <HqCard>
        <HqCardTitle>Optional alerts</HqCardTitle>
        <HqMuted>Job, payment and security messages are always delivered.</HqMuted>
        {prefs.isLoading ? (
          <HqMuted>Loading preferences…</HqMuted>
        ) : prefs.isError ? (
          <HqMuted>Could not load preferences. Open this screen again to retry.</HqMuted>
        ) : optionalCells.length === 0 ? (
          <HqMuted>Preference controls unavailable.</HqMuted>
        ) : (
          optionalCells.map((cell) => (
            <View key={cell.channel} style={styles.prefRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.notifTitle}>{CHANNEL_LABEL[cell.channel]}</Text>
                {!cell.available ? (
                  <Text style={styles.notifMeta}>Not available on this device yet</Text>
                ) : null}
              </View>
              <Switch
                accessibilityLabel={`${CHANNEL_LABEL[cell.channel]} optional alerts`}
                value={cell.enabled}
                disabled={!cell.editable || setPreference.isPending}
                onValueChange={(enabled) =>
                  setPreference.mutate({
                    channel: cell.channel,
                    category: cell.category,
                    enabled,
                  })
                }
                trackColor={{ false: partnerColors.line, true: partnerColors.primary }}
              />
            </View>
          ))
        )}
      </HqCard>
      <HqCard>
        <StatRow label="Unread" value={notifications.data?.unreadCount ?? 0} />
        {(notifications.data?.notifications ?? []).map((n) => (
          <Pressable
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={`${n.title}. ${n.message}. ${formatDate(n.createdAt)}. ${n.isRead ? "Read" : "Unread"}`}
            onPress={() => !n.isRead && markRead.mutate(n.id)}
            style={styles.notif}
          >
            <Text style={[styles.notifTitle, !n.isRead && styles.unread]}>{n.title}</Text>
            <Text style={styles.notifBody}>{n.message}</Text>
            <Text style={styles.notifMeta}>{formatDate(n.createdAt)}</Text>
          </Pressable>
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AccountSettingsScreen() {
  const provider = useProviderQuery();
  const [bio, setBio] = React.useState("");
  const save = useMutation({
    mutationFn: () => partnerApi.updateSettings({ bio, workingHoursStart: provider.data?.workingHoursStart ?? undefined, workingHoursEnd: provider.data?.workingHoursEnd ?? undefined }),
  });
  React.useEffect(() => {
    if (provider.data?.bio) setBio(provider.data.bio);
  }, [provider.data?.bio]);
  if (provider.isLoading) return <HqShell title="Settings" subtitle="Account settings"><LoadingBlock /></HqShell>;
  const p = provider.data!;
  return (
    <HqShell title="Settings" subtitle="Account, availability, working hours, and payment.">
      <HqCard>
        <HqCardTitle>Working hours</HqCardTitle>
        <StatRow label="Start" value={p.workingHoursStart ?? "—"} />
        <StatRow label="End" value={p.workingHoursEnd ?? "—"} />
        <StatRow label="Days" value={p.workingDays?.join(", ") || "—"} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Bio</HqCardTitle>
        <TextInput value={bio} onChangeText={setBio} multiline style={styles.input} placeholder="Tell customers about your experience" />
        <Pressable onPress={() => save.mutate()} style={styles.linkBtn}>
          <Text style={styles.linkBtnText}>{save.isPending ? "Saving…" : "Save settings"}</Text>
        </Pressable>
      </HqCard>
      <HqCard>
        <HqCardTitle>Payment preference</HqCardTitle>
        <StatRow label="Method" value={p.paymentMethodPreference ?? "—"} />
        <StatRow label="UPI ID" value={p.upiId ?? "—"} />
      </HqCard>
    </HqShell>
  );
}

export function AccountSupportScreen() {
  const tickets = useQuery({ queryKey: ["partner", "support"], queryFn: () => partnerApi.support.tickets() });
  if (tickets.isLoading) return <HqShell title="Help & Support" subtitle="Tickets"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Help & Support" subtitle="Support tickets and SLA status.">
      <HqCard>
        {(tickets.data?.tickets ?? []).length === 0 ? (
          <EmptyState message="No support tickets yet." />
        ) : (
          tickets.data!.tickets.map((t) => (
            <StatRow key={t.id} label={t.subject} value={t.status} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function AccountMembershipScreen() {
  const qc = useQueryClient();
  const [upgradingId, setUpgradingId] = useState<string | null>(null);
  const { openCheckout } = useRazorpayCheckout();
  const plans = useQuery({ queryKey: ["partner", "plans"], queryFn: () => partnerApi.subscriptions.plans() });
  const mine = useQuery({ queryKey: ["partner", "subscription"], queryFn: () => partnerApi.subscriptions.mine() });
  const entitlements = useQuery({ queryKey: ["partner", "entitlements"], queryFn: () => partnerApi.subscriptions.entitlements() });

  const upgrade = useMutation({
    mutationFn: async (planId: string) => {
      setUpgradingId(planId);
      const order = await partnerApi.subscriptions.createOrder(planId);
      await openCheckout({
        key: order.key,
        orderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        name: "HOMEEIGO Partner",
        description: order.planName,
        checkoutMode: order.checkoutMode,
        onSuccess: async (payload) => {
          await partnerApi.subscriptions.verify({
            razorpayOrderId: payload.razorpay_order_id,
            razorpayPaymentId: payload.razorpay_payment_id,
            razorpaySignature: payload.razorpay_signature,
          });
        },
        onDismiss: () => setUpgradingId(null),
        onFailure: () => setUpgradingId(null),
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "subscription"] });
      void qc.invalidateQueries({ queryKey: ["partner", "entitlements"] });
    },
    onSettled: () => setUpgradingId(null),
  });

  if (plans.isLoading) return <HqShell title="Membership" subtitle="Plans"><LoadingBlock /></HqShell>;

  const active = mine.data?.active;

  return (
    <HqShell title="Membership" subtitle="Subscription plans and entitlements.">
      {active ? (
        <HqCard>
          <StatRow label="Active plan" value={active.plan?.name ?? "—"} />
          <StatRow label="Renews" value={active.expiresAt ? formatDate(active.expiresAt) : "—"} />
        </HqCard>
      ) : (
        <HqCard><EmptyState message="No active subscription." /></HqCard>
      )}
      <HqCard>
        <HqCardTitle>Available plans</HqCardTitle>
        {plans.data?.map((p) => (
          <View key={p.id} style={styles.planRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.moduleTitle}>{p.name}</Text>
              <Text style={styles.moduleMeta}>{formatCurrency(p.price)}</Text>
            </View>
            {active?.plan?.id === p.id ? (
              <Text style={styles.moduleMeta}>Current</Text>
            ) : (
              <Pressable
                disabled={upgrade.isPending}
                onPress={() => upgrade.mutate(p.id)}
                style={styles.smallBtn}
              >
                <Text style={styles.smallBtnText}>{upgradingId === p.id ? "…" : "Upgrade"}</Text>
              </Pressable>
            )}
          </View>
        ))}
      </HqCard>
      {entitlements.data ? (
        <HqCard>
          <HqCardTitle>{`Benefits (${entitlements.data.tier ?? "free"})`}</HqCardTitle>
          {entitlements.data.benefits.map((b) => (
            <Text key={`${b.type}-${b.label}`} style={styles.benefit}>
              • {b.label}
            </Text>
          ))}
        </HqCard>
      ) : null}
      <HqMuted>For test payments use UPI: success@razorpay or card 5555 5555 5555 4444.</HqMuted>
    </HqShell>
  );
}

export function AccountInvoicesScreen() {
  const invoices = useQuery({ queryKey: ["partner", "invoices"], queryFn: () => partnerApi.invoices() });
  if (invoices.isLoading) return <HqShell title="Invoices" subtitle="Earnings invoices"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Invoices" subtitle="Earnings invoices and settlements.">
      <HqCard>
        <HqCardTitle>Earnings invoices</HqCardTitle>
        {(invoices.data?.earnings ?? []).map((i) => (
          <StatRow key={i.id} label={`${i.invoiceNumber} · ${i.service}`} value={formatCurrency(i.net)} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>Settlements</HqCardTitle>
        {(invoices.data?.settlements ?? []).map((s) => (
          <StatRow key={s.id} label={s.settlementNumber} value={formatCurrency(s.netAmount)} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AccountAvailabilityScreen() {
  return <AvailabilityWorkspaceScreen />;
}

/**
 * The former `AccountMapScreen` lived here: a list that deep-linked out to Google Maps in the
 * browser rather than rendering a map. It is replaced by the real in-app map in
 * `src/screens/partner-live-map.tsx`, wired to the same `account-map` HQ registry id.
 */

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  module: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: partnerColors.line },
  moduleTitle: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  moduleMeta: { marginTop: 2, fontSize: 11, color: partnerColors.textMuted },
  moduleBody: { marginTop: 6, fontSize: 12, color: partnerColors.textMuted, lineHeight: 17 },
  smallBtn: { marginTop: 8, alignSelf: "flex-start", backgroundColor: partnerColors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  linkBtn: { marginTop: 8, backgroundColor: partnerColors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  linkBtnText: { color: "#fff", fontWeight: "700" },
  sosText: { fontSize: 14, color: partnerColors.text, lineHeight: 20, marginBottom: 12 },
  sosBtn: { backgroundColor: partnerColors.primaryDark, borderRadius: 12, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  sosBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  outlineBtn: { borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingVertical: 14, alignItems: "center", marginTop: 8 },
  outlineBtnText: { fontWeight: "700", color: partnerColors.text },
  notif: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: partnerColors.line },
  notifTitle: { fontSize: 14, fontWeight: "600", color: partnerColors.text },
  unread: { color: partnerColors.primary },
  notifBody: { marginTop: 2, fontSize: 12, color: partnerColors.textMuted },
  notifMeta: { marginTop: 4, fontSize: 11, color: partnerColors.textMuted },
  prefRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 44 },
  input: { borderWidth: 1, borderColor: partnerColors.line, borderRadius: 10, padding: 10, minHeight: 80, textAlignVertical: "top", backgroundColor: "#fff" },
  inviteInput: { borderWidth: 1, borderColor: partnerColors.line, borderRadius: 10, padding: 12, minHeight: 44, backgroundColor: "#fff", marginBottom: 8 },
  benefit: { fontSize: 13, color: partnerColors.text, marginBottom: 6 },
  planRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: partnerColors.line,
  },
});
