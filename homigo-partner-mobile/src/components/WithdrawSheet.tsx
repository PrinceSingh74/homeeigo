import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { formatCurrency } from "@/lib/format";
import { validateWithdrawInput } from "@/lib/finance";
import { partnerColors } from "@/theme/colors";

type Props = {
  visible: boolean;
  availableBalance: number;
  onClose: () => void;
  onSuccess?: () => void;
};

/**
 * Partner bank withdrawal — mirrors partner-web WithdrawModal.
 * Idempotent: submit disabled while request in flight (no double-tap debit).
 */
export function WithdrawSheet({ visible, availableBalance, onClose, onSuccess }: Props) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const idempotencyKeyRef = useRef("");

  const resetForm = useCallback(() => {
    setAmount("");
    setAccountHolder("");
    setBankAccountNumber("");
    setIfscCode("");
    setFormError(null);
    setSuccessMsg(null);
    submittingRef.current = false;
    idempotencyKeyRef.current = "";
  }, []);

  useEffect(() => {
    if (visible) resetForm();
  }, [visible, resetForm]);

  const withdraw = useMutation({
    mutationFn: (payload: {
      amount: number;
      bankAccountNumber: string;
      ifscCode: string;
      accountHolder: string;
      idempotencyKey?: string;
    }) => partnerApi.withdraw(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "payouts"] });
      void qc.invalidateQueries({ queryKey: ["partner", "wallet"] });
      void qc.invalidateQueries({ queryKey: ["partner", "wallet-txns"] });
      void qc.invalidateQueries({ queryKey: ["partner", "wallet-txns-all"] });
      void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
      void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
      setSuccessMsg("Withdrawal requested. Processing typically takes 1–3 business days.");
      onSuccess?.();
    },
    onError: (err: Error) => setFormError(err.message || "Withdrawal unavailable"),
    onSettled: () => {
      submittingRef.current = false;
    },
  });

  const numericAmount = Math.floor(Number(amount) || 0);
  const isSubmitting = withdraw.isPending;

  async function handleSubmit() {
    if (submittingRef.current || isSubmitting) return;
    setFormError(null);
    const err = validateWithdrawInput({
      amount: numericAmount,
      availableBalance,
      accountHolder,
      bankAccountNumber,
      ifscCode,
    });
    if (err) {
      setFormError(err);
      return;
    }
    submittingRef.current = true;
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = `wd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
    withdraw.mutate({
      amount: numericAmount,
      bankAccountNumber: bankAccountNumber.replace(/\s/g, ""),
      ifscCode: ifscCode.trim().toUpperCase(),
      accountHolder: accountHolder.trim(),
      idempotencyKey: idempotencyKeyRef.current,
    });
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={() => !isSubmitting && onClose()}>
      <View style={styles.backdrop} pointerEvents="box-none">
        <Pressable
          style={styles.backdropDismiss}
          onPress={() => !isSubmitting && onClose()}
          accessibilityLabel="Close withdraw sheet"
          accessibilityRole="button"
        />
        <View style={styles.sheet} accessibilityViewIsModal accessibilityLabel="Withdraw to bank" collapsable={false}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetInner}>
            <Text style={styles.title} testID="withdraw-sheet-heading">
              Withdraw to bank
            </Text>
            <Text style={styles.subtitle} accessibilityLabel={`Available balance ${formatCurrency(availableBalance)}`}>
              Available: <Text style={styles.subtitleBold}>{formatCurrency(availableBalance)}</Text>
            </Text>

            {successMsg ? (
              <View style={styles.successBox} accessibilityRole="text" testID="withdraw-success">
                <Text
                  style={styles.successText}
                  testID="withdraw-success-copy"
                  accessibilityRole="text"
                  accessibilityLabel={successMsg}
                  accessible
                >
                  {successMsg}
                </Text>
                <Pressable onPress={onClose} style={styles.doneBtn} accessibilityRole="button" accessibilityLabel="Done">
                  <Text style={styles.doneBtnText}>Done</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Field label="Amount (₹)">
                  <TextInput
                    value={amount}
                    onChangeText={setAmount}
                    keyboardType="number-pad"
                    placeholder="e.g. 500"
                    editable={!isSubmitting}
                    style={styles.input}
                    accessibilityLabel="Withdrawal amount"
                    testID="withdraw-amount"
                  />
                </Field>
                <Field label="Account holder name">
                  <TextInput
                    value={accountHolder}
                    onChangeText={setAccountHolder}
                    placeholder="As per bank records"
                    editable={!isSubmitting}
                    style={styles.input}
                    accessibilityLabel="Account holder name"
                    testID="withdraw-holder"
                  />
                </Field>
                <Field label="Bank account number">
                  <TextInput
                    value={bankAccountNumber}
                    onChangeText={(v) => setBankAccountNumber(v.replace(/\D/g, ""))}
                    keyboardType="number-pad"
                    placeholder="XXXXXXXXXX"
                    editable={!isSubmitting}
                    style={styles.input}
                    accessibilityLabel="Bank account number"
                    testID="withdraw-account"
                    secureTextEntry
                  />
                </Field>
                <Field label="IFSC code">
                  <TextInput
                    value={ifscCode}
                    onChangeText={(v) => setIfscCode(v.toUpperCase())}
                    placeholder="HDFC0001234"
                    maxLength={11}
                    autoCapitalize="characters"
                    editable={!isSubmitting}
                    style={styles.input}
                    accessibilityLabel="IFSC code"
                    testID="withdraw-ifsc"
                  />
                </Field>

                {formError ? (
                  <Text
                    style={styles.error}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="assertive"
                    accessibilityLabel={formError}
                    testID="withdraw-form-error"
                    accessible
                  >
                    {formError}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => !isSubmitting && onClose()}
                    disabled={isSubmitting}
                    style={[styles.cancelBtn, isSubmitting && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel withdrawal"
                  >
                    <Text style={styles.cancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    collapsable={false}
                    nativeID="withdraw-submit"
                    testID="withdraw-submit"
                    onPress={() => void handleSubmit()}
                    disabled={isSubmitting || availableBalance <= 0}
                    style={[styles.submitBtn, (isSubmitting || availableBalance <= 0) && styles.disabled]}
                    accessibilityRole="button"
                    accessibilityLabel="Submit withdrawal"
                    accessibilityHint="Requests a bank withdrawal of the entered amount"
                    accessibilityState={{
                      disabled: isSubmitting || availableBalance <= 0,
                      busy: isSubmitting,
                    }}
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="#fff" testID="withdraw-submit-busy" />
                    ) : (
                      <Text style={styles.submitText} accessible={false}>
                        Request withdrawal
                      </Text>
                    )}
                  </Pressable>
                </View>
                <Text style={styles.disclaimer}>
                  Withdrawals typically settle in 1–3 business days. Pending funds cannot be withdrawn.
                </Text>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  backdropDismiss: { flex: 1 },
  sheet: {
    maxHeight: "90%",
    backgroundColor: partnerColors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: partnerColors.line,
  },
  sheetInner: { padding: 20, paddingBottom: 32 },
  title: { fontSize: 18, fontWeight: "700", color: partnerColors.text },
  subtitle: { marginTop: 4, fontSize: 13, color: partnerColors.textMuted },
  subtitleBold: { fontWeight: "700", color: partnerColors.text },
  field: { marginTop: 14 },
  fieldLabel: { fontSize: 12, color: partnerColors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: partnerColors.text,
    backgroundColor: partnerColors.cream,
  },
  error: { marginTop: 12, fontSize: 13, color: partnerColors.danger },
  successBox: { marginTop: 16, padding: 16, borderRadius: 12, backgroundColor: `${partnerColors.primary}18` },
  successText: { fontSize: 14, color: partnerColors.text, lineHeight: 20 },
  doneBtn: {
    marginTop: 14,
    backgroundColor: partnerColors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  doneBtnText: { color: "#fff", fontWeight: "700" },
  actions: { flexDirection: "row", gap: 10, marginTop: 18 },
  cancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  cancelText: { color: partnerColors.text, fontWeight: "600" },
  submitBtn: {
    flex: 1.4,
    backgroundColor: partnerColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.55 },
  disclaimer: { marginTop: 12, fontSize: 11, color: partnerColors.textMuted, lineHeight: 16 },
});
