import { useMutation, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { failureSentence } from "@/components/money/DataScreen";
import { Banner, Button, Field, KeyValue, Sheet, T } from "@/components/ui";
import { K, usePayoutsQuery } from "@/hooks/money/queries";
import { formatDayTime, rupees, withdrawalStatus } from "@/lib/money-format";
import {
  keyForRequest,
  settleRequest,
  validateWithdrawForm,
  verificationNotice,
  withdrawKeyLedger,
  withdrawOutcome,
  withdrawPayload,
  withdrawRefusal,
  type WithdrawFieldErrors,
  type WithdrawForm,
  type WithdrawRefusal,
} from "@/lib/money-withdraw";
import { newIdempotencyKey, partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { space } from "@/theme/tokens";
import type { WithdrawResult } from "@/types/partner";

type Props = {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
};

type WithdrawCall = { payload: Parameters<typeof partnerApi.withdraw>[0]; signature: string };

const EMPTY: WithdrawForm = { amountText: "", accountHolder: "", bankAccountNumber: "", ifscCode: "" };

/**
 * Withdraw to a bank account (`POST /api/wallet/withdraw`).
 *
 * The body is exactly what the route takes: amount, account number, IFSC, holder name — bank only,
 * there is no UPI field on the server — plus an `idempotencyKey`, so a double tap or a retry after a
 * lost answer is the same withdrawal, not a second one. The key is held in `withdrawKeyLedger`, not
 * in this sheet: closing and reopening must not mint a new key for a request whose answer was lost.
 *
 * The balance (`availableBalance` of `GET /api/providers/me/payouts`) is read again every time the
 * sheet opens. Only that fresh figure may flag an amount as too large; a cached one never refuses
 * anything — the server is the judge. The server sends no minimum, no fee and no processing time
 * before the withdrawal exists, so the sheet states none. A refusal is shown in the server's own
 * sentence; the unverified-email refusal offers the one action that exists (an emailed link — there
 * is no code to type in the app).
 */
export function WithdrawSheet({ visible, onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const owner = useAuthStore((s) => s.user?.id ?? "");
  const payouts = usePayoutsQuery();
  const refetchPayouts = payouts.refetch;
  /** Whether the balance on show was read from the server since the sheet opened. */
  const [balanceRead, setBalanceRead] = useState<"reading" | "fresh" | "failed">("reading");
  const [form, setForm] = useState<WithdrawForm>(EMPTY);
  const [errors, setErrors] = useState<WithdrawFieldErrors>({});
  const [refusal, setRefusal] = useState<WithdrawRefusal | null>(null);
  const [done, setDone] = useState<{ withdrawal: WithdrawResult; message: string | null } | null>(null);
  const inFlight = useRef(false);
  /** The balance read started when the sheet opened: the fresh figure, or null when it failed. */
  const balanceReadNow = useRef<Promise<number | null>>(Promise.resolve(null));
  /** A submit is waiting for that read. */
  const [checking, setChecking] = useState(false);

  const withdraw = useMutation({
    mutationFn: ({ payload }: WithdrawCall) => partnerApi.withdraw(payload),
    onSuccess: (result, { signature }) => {
      settleRequest(withdrawKeyLedger, signature, withdrawOutcome(null));
      setDone(result);
      for (const queryKey of [K.payouts, K.withdrawals, K.invoices, K.provider, K.dashboard]) void qc.invalidateQueries({ queryKey });
      onSuccess?.();
    },
    onError: (error, { signature }) => {
      // A refusal retires the key; a lost answer or a server error keeps it for the same request.
      settleRequest(withdrawKeyLedger, signature, withdrawOutcome(error));
      setRefusal(withdrawRefusal(error));
      // The request may have landed: read the balance and the withdrawal list again so it shows.
      for (const queryKey of [K.payouts, K.withdrawals]) void qc.invalidateQueries({ queryKey });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const verification = useMutation({ mutationFn: () => partnerApi.security.sendVerificationEmail() });
  const resetWithdraw = withdraw.reset;
  const resetVerification = verification.reset;

  useEffect(() => {
    if (!visible) return;
    setForm(EMPTY);
    setErrors({});
    setRefusal(null);
    setDone(null);
    inFlight.current = false;
    resetWithdraw();
    resetVerification();
    // The idempotency keys are deliberately NOT cleared here — see `withdrawKeyLedger`.
    let cancelled = false;
    setBalanceRead("reading");
    setChecking(false);
    const read = refetchPayouts().then(
      (result) => (result.isError || result.data === undefined ? null : result.data.availableBalance),
      () => null,
    );
    balanceReadNow.current = read;
    void read.then((balance) => {
      if (!cancelled) setBalanceRead(balance === null ? "failed" : "fresh");
    });
    return () => {
      cancelled = true;
    };
  }, [visible, resetWithdraw, resetVerification, refetchPayouts]);

  const busy = withdraw.isPending || checking;
  /** The last figure the server sent. It is shown; only a fresh one is used to judge an amount. */
  const shownBalance = payouts.data?.availableBalance ?? null;
  const freshBalance = balanceRead === "fresh" ? shownBalance : null;
  const nothingToWithdraw = freshBalance !== null && !(freshBalance > 0);
  const notice = verification.isSuccess ? verificationNotice(verification.data, formatDayTime) : null;

  function set<F extends keyof WithdrawForm>(field: F, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  }

  async function submit() {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    setRefusal(null);
    // A tap that beats the balance read waits for it, so the amount is judged against the fresh
    // figure when there is one. A failed read judges nothing: the server decides.
    let balance = freshBalance;
    if (balanceRead === "reading") {
      setChecking(true);
      balance = await balanceReadNow.current;
      setChecking(false);
    }
    const found = validateWithdrawForm(form, balance, rupees);
    setErrors(found);
    const payload = Object.keys(found).length > 0 ? null : withdrawPayload(form);
    if (!payload) {
      inFlight.current = false;
      return;
    }
    const keyed = keyForRequest(withdrawKeyLedger, owner, payload, () => newIdempotencyKey("withdraw"));
    withdraw.mutate({ payload: { ...payload, idempotencyKey: keyed.key }, signature: keyed.signature });
  }

  if (done) {
    const status = withdrawalStatus(done.withdrawal.status);
    return (
      <Sheet visible={visible} onClose={onClose} title="Withdraw to bank" testID="withdraw-sheet" footer={<Button label="Done" onPress={onClose} testID="withdraw-done" />}>
        <View testID="withdraw-success" style={styles.stack}>
          <Banner tone="success" title="Withdrawal requested" message={done.message ?? "The server accepted your request."} testID="withdraw-success-copy" />
          <View>
            <KeyValue label="Reference" value={done.withdrawal.withdrawalNumber} testID="withdraw-success-reference" />
            <KeyValue label="Amount" value={rupees(done.withdrawal.amount)} strong />
            <KeyValue label="Status" value={status.label} />
            <KeyValue label="Requested" value={formatDayTime(done.withdrawal.createdAt)} />
          </View>
          <T kind="small">
            What happens next: HOMEEIGO approves the request and sends the money to this bank account. The amount is held from your available balance until then. Follow its status under Recent withdrawals in your wallet.
          </T>
        </View>
      </Sheet>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Withdraw to bank"
      dismissable={!busy}
      testID="withdraw-sheet"
      footer={
        <>
          <Button
            label="Request withdrawal"
            accessibilityLabel="Submit withdrawal"
            onPress={() => void submit()}
            loading={busy}
            disabled={nothingToWithdraw}
            hint={nothingToWithdraw ? "No balance to withdraw" : null}
            testID="withdraw-submit"
          />
          <Button label="Cancel" accessibilityLabel="Cancel withdrawal" variant="quiet" onPress={onClose} disabled={busy} testID="withdraw-cancel" />
        </>
      }
    >
      <T kind="body" numeric testID="withdraw-sheet-heading" accessibilityLabel={`Available balance ${rupees(shownBalance)}`}>
        {`Available: ${rupees(shownBalance)}`}
      </T>
      {balanceRead === "reading" ? (
        <T kind="small" testID="withdraw-balance-reading">
          Checking your balance…
        </T>
      ) : balanceRead === "failed" ? (
        <T kind="small" testID="withdraw-balance-stale">
          Your balance could not be refreshed, so this figure may be out of date. The server checks the amount when you request the withdrawal.
        </T>
      ) : null}

      <Field
        label="Amount (₹)"
        value={form.amountText}
        onChangeText={(v) => set("amountText", v.replace(/[^\d.]/g, ""))}
        error={errors.amountText}
        keyboardType="decimal-pad"
        editable={!busy}
        accessibilityLabel="Withdrawal amount"
        testID="withdraw-amount"
      />
      <Field
        label="Account holder name"
        value={form.accountHolder}
        onChangeText={(v) => set("accountHolder", v)}
        error={errors.accountHolder}
        help="As it appears on the bank account."
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={100}
        editable={!busy}
        testID="withdraw-holder"
      />
      <Field
        label="Bank account number"
        value={form.bankAccountNumber}
        onChangeText={(v) => set("bankAccountNumber", v.replace(/\D/g, ""))}
        error={errors.bankAccountNumber}
        help="9 to 18 digits."
        keyboardType="number-pad"
        maxLength={18}
        secure
        editable={!busy}
        testID="withdraw-account"
      />
      <Field
        label="IFSC code"
        value={form.ifscCode}
        onChangeText={(v) => set("ifscCode", v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
        error={errors.ifscCode}
        help="11 characters, for example HDFC0001234."
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={11}
        editable={!busy}
        testID="withdraw-ifsc"
      />

      {refusal ? (
        <Banner
          tone={refusal.kind === "refused" || refusal.kind === "insufficient_balance" ? "danger" : "warning"}
          title={refusal.note ? refusal.sentence : undefined}
          message={refusal.note ?? refusal.sentence}
          testID="withdraw-form-error"
          action={
            refusal.kind === "email_unverified" && !verification.isSuccess ? (
              <Button
                label="Email me a verification link"
                variant="secondary"
                onPress={() => verification.mutate()}
                loading={verification.isPending}
                testID="withdraw-send-verification"
              />
            ) : undefined
          }
        />
      ) : null}

      {refusal?.kind === "email_unverified" && notice?.sent ? (
        <Banner tone="success" title={notice.title} message={notice.message} testID="withdraw-verification-sent" />
      ) : null}
      {refusal?.kind === "email_unverified" && notice && !notice.sent ? (
        <Banner
          tone="warning"
          title={notice.title}
          message={notice.message}
          testID="withdraw-verification-no-email"
          action={
            <Button
              label="Help and support"
              variant="secondary"
              onPress={() => {
                onClose();
                router.push("/hq/account-support");
              }}
              testID="withdraw-open-support"
            />
          }
        />
      ) : null}
      {refusal?.kind === "email_unverified" && verification.isError ? (
        <Banner tone="danger" message={failureSentence(verification.error)} testID="withdraw-verification-error" />
      ) : null}

      <T kind="small">Money still held for a withdrawal in progress cannot be withdrawn again.</T>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
});
