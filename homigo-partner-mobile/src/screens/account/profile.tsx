import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { BadgeCheck, KeyRound, LogOut, Mail, MonitorSmartphone, Pencil, UserRound } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AccountScreen, ErrorState, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { Banner, Button, Card, Field, KeyValue, Pill, Section, Sheet, T } from "@/components/ui";
import { useAuthed, useProviderQuery, usePullRefresh, useUserProfileQuery } from "@/hooks/account/queries";
import { changePasswordError, fullName, roleLabel, sessionTitle, sortSessions } from "@/lib/account-rules";
import { formatDate, formatDateTime } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { color, radius, space } from "@/theme/tokens";
import type { PartnerUserProfile } from "@/types/partner";

async function signOutToLogin() {
  await useAuthStore.getState().logout();
  router.replace("/login");
}

/** The email line: the address, whether the server has it as verified, and how to verify it. */
function EmailCard({ profile }: { profile: PartnerUserProfile }) {
  const [result, setResult] = useState<ActionResult>(null);
  const send = useMutation({
    mutationFn: () => partnerApi.security.sendVerificationEmail(),
    onMutate: () => setResult(null),
    onSuccess: (data) =>
      setResult({
        tone: "success",
        message: `${data.message} Open the link in that email${data.email ? ` (${data.email})` : ""} before ${formatDateTime(data.expiresAt)}. The link opens in your browser: there is no code to type here, and it does not open this app. Then pull down on this screen to refresh.`,
      }),
    onError: (e) => setResult(failure(e, "The verification email could not be sent.")),
  });
  return (
    <Card testID="profile-email">
      <View style={styles.stack}>
        <View style={styles.rowBetween}>
          <View style={styles.flex}>
            <T kind="small">Email</T>
            <T kind="bodyStrong" selectable>
              {profile.email ?? "No email on this account"}
            </T>
          </View>
          {profile.email ? <Pill label={profile.isEmailVerified ? "Verified" : "Not verified"} tone={profile.isEmailVerified ? "success" : "warning"} icon={profile.isEmailVerified ? BadgeCheck : Mail} testID="profile-email-state" /> : null}
        </View>
        {profile.email && !profile.isEmailVerified ? (
          <>
            <T kind="small">A verified email is needed before you can withdraw your earnings.</T>
            <Button label="Verify email" variant="secondary" icon={Mail} onPress={() => send.mutate()} loading={send.isPending} testID="profile-verify-email" />
          </>
        ) : null}
        <ResultBanner result={result} testID="profile-verify-result" />
      </View>
    </Card>
  );
}

function EditProfileSheet({ profile, visible, onClose, onSaved }: { profile: PartnerUserProfile; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const qc = useQueryClient();
  const [first, setFirst] = useState(profile.firstName ?? "");
  const [last, setLast] = useState(profile.lastName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [problem, setProblem] = useState<ActionResult>(null);
  const save = useMutation({
    mutationFn: () => {
      // Only what changed is sent; an emptied name is not sent as an empty string.
      const body: { firstName?: string; lastName?: string; bio?: string } = {};
      if (first.trim() && first.trim() !== (profile.firstName ?? "")) body.firstName = first.trim();
      if (last.trim() && last.trim() !== (profile.lastName ?? "")) body.lastName = last.trim();
      if (bio.trim() !== (profile.bio ?? "")) body.bio = bio.trim();
      return partnerApi.updateProfile(body);
    },
    onMutate: () => setProblem(null),
    onSuccess: (user) => {
      qc.setQueryData(["partner", "user-profile"], user);
      void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
      // The greeting on Home reads the session's copy of the name.
      useAuthStore.setState((s) => ({ user: s.user ? { ...s.user, firstName: user.firstName, lastName: user.lastName } : s.user }));
      onSaved();
      onClose();
    },
    onError: (e) => setProblem(failure(e, "Your profile could not be saved.")),
  });
  const changed = first.trim() !== (profile.firstName ?? "") || last.trim() !== (profile.lastName ?? "") || bio.trim() !== (profile.bio ?? "");
  return (
    <Sheet visible={visible} onClose={onClose} title="Edit profile" dismissable={!save.isPending} testID="profile-edit-sheet" footer={<Button label="Save profile" onPress={() => save.mutate()} loading={save.isPending} disabled={!changed || !first.trim()} testID="profile-save" />}>
      <Field label="First name" value={first} onChangeText={setFirst} autoComplete="given-name" error={!first.trim() ? "Enter your first name." : null} testID="profile-first-name" />
      <Field label="Last name" value={last} onChangeText={setLast} autoComplete="family-name" testID="profile-last-name" />
      <Field label="About you" value={bio} onChangeText={setBio} multiline maxLength={500} help="Up to 500 characters." testID="profile-bio" />
      <T kind="small">Your email and phone number cannot be changed here. Contact support to change them.</T>
      <ResultBanner result={problem} testID="profile-save-error" />
    </Sheet>
  );
}

function ChangePasswordSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<ActionResult>(null);
  const [done, setDone] = useState(false);
  const change = useMutation({
    mutationFn: () => partnerApi.security.changePassword({ currentPassword: current, newPassword: next }),
    onMutate: () => setProblem(null),
    onSuccess: () => setDone(true),
    onError: (e) => setProblem(failure(e, "Your password could not be changed.")),
  });
  const localError = changePasswordError({ current, next, confirm });
  if (done) {
    return (
      <Sheet visible={visible} onClose={() => void signOutToLogin()} title="Password changed" dismissable={false} testID="password-done-sheet" footer={<Button label="Sign in again" onPress={() => void signOutToLogin()} testID="password-sign-in-again" />}>
        <Banner tone="success" message="Your password was changed. Every device was signed out, including this one. Sign in with your new password." />
      </Sheet>
    );
  }
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Change password"
      dismissable={!change.isPending}
      testID="password-sheet"
      footer={<Button label="Change password and sign out" onPress={() => change.mutate()} loading={change.isPending} disabled={Boolean(localError)} hint={current && next && confirm ? localError : null} testID="password-submit" />}
    >
      <Banner tone="warning" title="You will be signed out everywhere" message="Changing your password signs you out of every device, including this phone. You will sign in again with the new password." testID="password-warning" />
      <Field label="Current password" value={current} onChangeText={setCurrent} secure autoComplete="current-password" autoCapitalize="none" testID="password-current" />
      <Field label="New password" value={next} onChangeText={setNext} secure autoComplete="new-password" autoCapitalize="none" help="8 or more characters with an uppercase letter, a lowercase letter, a number and a special character." testID="password-new" />
      <Field label="New password again" value={confirm} onChangeText={setConfirm} secure autoComplete="new-password" autoCapitalize="none" testID="password-confirm" />
      <ResultBanner result={problem} testID="password-error" />
    </Sheet>
  );
}

function SessionsCard() {
  const qc = useQueryClient();
  const enabled = useAuthed();
  const sessions = useQuery({ queryKey: ["partner", "sessions"], queryFn: () => partnerApi.security.sessions(), enabled });
  const [result, setResult] = useState<ActionResult>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["partner", "sessions"] });
  const revoke = useMutation({
    mutationFn: (id: string) => partnerApi.security.revokeSession(id),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await refresh();
      setResult({ tone: "success", message: "That device was signed out." });
    },
    onError: (e) => setResult(failure(e, "That device could not be signed out.")),
  });
  const revokeOthers = useMutation({
    mutationFn: () => partnerApi.security.revokeOtherSessions(),
    onMutate: () => setResult(null),
    onSuccess: async (data) => {
      await refresh();
      setResult({ tone: "success", message: data.revoked === 0 ? "No other device was signed in." : `${data.revoked} other ${data.revoked === 1 ? "device was" : "devices were"} signed out.` });
    },
    onError: (e) => setResult(failure(e, "The other devices could not be signed out.")),
  });
  const rows = sessions.data ? sortSessions(sessions.data.sessions) : null;
  const others = rows?.filter((s) => !s.isCurrent).length ?? 0;
  const busy = revoke.isPending || revokeOthers.isPending;
  return (
    <Card testID="profile-sessions">
      <View style={styles.stack}>
        <View style={styles.rowBetween}>
          <T kind="heading" accessibilityRole="header">
            Signed-in devices
          </T>
          <MonitorSmartphone color={color.slate} size={20} />
        </View>
        {sessions.isLoading ? (
          <T kind="small">Loading your devices…</T>
        ) : !rows ? (
          <ErrorState error={sessions.error} title="Your devices could not be loaded" onRetry={() => void sessions.refetch()} />
        ) : rows.length === 0 ? (
          <T kind="small">No signed-in devices were returned.</T>
        ) : (
          rows.map((s) => (
            <View key={s.id} style={styles.session} testID={`session-${s.id}`}>
              <T kind="bodyStrong">{sessionTitle(s)}</T>
              <T kind="small" numeric>
                Signed in {formatDate(s.createdAt)}
                {s.lastActivityAt ? ` · last active ${formatDateTime(s.lastActivityAt)}` : ""}
                {s.ipAddress ? ` · ${s.ipAddress}` : ""}
              </T>
              <Button
                label="Sign out of this device"
                variant="secondary"
                accessibilityLabel={`Sign out of ${sessionTitle(s)}`}
                onPress={() => revoke.mutate(s.id)}
                loading={revoke.isPending && revoke.variables === s.id}
                disabled={s.isCurrent || busy}
                hint={s.isCurrent ? "This is the phone in your hand. Use Sign out to leave it." : null}
                testID={`session-revoke-${s.id}`}
              />
            </View>
          ))
        )}
        <Button label="Sign out everywhere else" variant="danger" onPress={() => revokeOthers.mutate()} loading={revokeOthers.isPending} disabled={busy || (rows != null && others === 0)} hint={rows != null && others === 0 ? "No other device is signed in." : null} testID="sessions-revoke-others" />
        <ResultBanner result={result} testID="sessions-result" />
      </View>
    </Card>
  );
}

/** Identity, email verification, editing, password and devices — shared by the Profile tab and HQ → Profile. */
export function ProfileBody() {
  const role = useAuthStore((s) => s.user?.role);
  const profile = useUserProfileQuery();
  const [editing, setEditing] = useState(false);
  const [changing, setChanging] = useState(false);
  const [saved, setSaved] = useState<ActionResult>(null);
  const [signingOut, setSigningOut] = useState(false);
  const p = profile.data;
  const roleWord = roleLabel(role);

  return (
    <View style={styles.body}>
      {profile.isLoading ? (
        <RowsSkeleton rows={3} label="Loading your profile" />
      ) : !p ? (
        <Card>
          <ErrorState error={profile.error} title="Your profile could not be loaded" onRetry={() => void profile.refetch()} testID="profile-error" />
        </Card>
      ) : (
        <>
          <Card testID="profile-identity">
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <UserRound color={color.leaf} size={28} />
              </View>
              <View style={styles.flex}>
                <T kind="title" testID="profile-name">
                  {fullName(p.firstName, p.lastName) ?? "Name not set"}
                </T>
                {roleWord ? <Pill label={roleWord} tone="leaf" testID="profile-role" /> : null}
              </View>
            </View>
            <View style={styles.identityRows}>
              <KeyValue label="Phone" value={p.phoneNumber ? `${p.phoneNumber}${p.isPhoneVerified ? " · verified" : " · not verified"}` : "—"} />
              <KeyValue label="Partner since" value={formatDate(p.createdAt)} />
            </View>
            {p.bio ? <T kind="body">{p.bio}</T> : null}
            <Button label="Edit profile" variant="secondary" icon={Pencil} onPress={() => setEditing(true)} style={styles.topGap} testID="profile-edit" />
          </Card>
          <ResultBanner result={saved} testID="profile-saved" />
          <EmailCard profile={p} />
          {editing ? <EditProfileSheet profile={p} visible onClose={() => setEditing(false)} onSaved={() => setSaved({ tone: "success", message: "Profile saved." })} /> : null}
        </>
      )}

      <Section title="Security" style={styles.section}>
        <Card>
          <View style={styles.stack}>
            <T kind="small">Changing your password signs you out of every device, including this one.</T>
            <Button label="Change password" variant="secondary" icon={KeyRound} onPress={() => setChanging(true)} testID="profile-change-password" />
          </View>
        </Card>
        <SessionsCard />
        <Button label="Sign out" variant="danger" icon={LogOut} loading={signingOut} onPress={() => { setSigningOut(true); void signOutToLogin(); }} testID="profile-sign-out" />
      </Section>
      {changing ? <ChangePasswordSheet visible onClose={() => setChanging(false)} /> : null}
    </View>
  );
}

/** HQ → Profile: the account, plus the partner record the server holds. */
export function AccountProfileScreen() {
  const qc = useQueryClient();
  const provider = useProviderQuery();
  const { refreshing, onRefresh } = usePullRefresh(provider, { refetch: () => qc.invalidateQueries({ queryKey: ["partner", "user-profile"] }) }, { refetch: () => qc.invalidateQueries({ queryKey: ["partner", "sessions"] }) });
  const p = provider.data;
  return (
    <AccountScreen title="Profile" refreshing={refreshing} onRefresh={onRefresh}>
      <ProfileBody />
      <Section title="Your partner record" style={styles.section}>
        {provider.isLoading ? (
          <RowsSkeleton label="Loading your partner record" />
        ) : !p ? (
          <Card>
            <ErrorState error={provider.error} title="Your partner record could not be loaded" onRetry={() => void provider.refetch()} />
          </Card>
        ) : (
          <>
            <Card>
              {p.businessName ? <KeyValue label="Business name" value={p.businessName} /> : null}
              <KeyValue label="City" value={p.city ?? "—"} />
              <KeyValue label="Customer rating" value={p.totalReviews > 0 ? `${p.rating.toFixed(1)} from ${p.totalReviews} reviews` : "No reviews yet"} />
              <KeyValue label="Jobs completed" value={String(p.completedBookings)} />
            </Card>
            <Card>
              <View style={styles.stack}>
                <T kind="heading" accessibilityRole="header">
                  Services you can be offered
                </T>
                {p.services.length === 0 ? <T kind="small">No service is approved for you yet.</T> : p.services.map((s) => <T key={s.id} kind="body">{s.name}</T>)}
                <Button label="Open my services" variant="quiet" onPress={() => router.push("/hq/academy-services")} />
              </View>
            </Card>
          </>
        )}
      </Section>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  section: { marginTop: space.sm },
  stack: { gap: space.md },
  flex: { flex: 1, gap: space.xs },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: space.md },
  identity: { flexDirection: "row", alignItems: "center", gap: space.lg },
  identityRows: { marginTop: space.md },
  avatar: { width: 60, height: 60, borderRadius: radius.pill, backgroundColor: color.leafWash, alignItems: "center", justifyContent: "center" },
  topGap: { marginTop: space.md },
  session: { gap: space.xs, paddingBottom: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
});
