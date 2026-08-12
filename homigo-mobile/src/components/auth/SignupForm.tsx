import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { PhoneField } from "@/components/auth/PhoneField";
import { OAuthProviderButtons } from "@/components/auth/OAuthProviderButtons";
import { formatPhoneE164 } from "@/lib/auth/phone";
import { savePendingRegistration } from "@/lib/auth/pending-registration";
import { savePendingReferralCode } from "@/lib/auth/pending-referral";
import { signupSchema, type SignupFormValues } from "@/lib/auth/schemas";

type SignupFieldValues = Omit<SignupFormValues, "agreeToTerms">;
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { radius, spacing } from "@/lib/typography";

export function SignupForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ ref?: string; referral?: string }>();
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [agreeToTerms, setAgreeToTerms] = useState(false);
  const [values, setValues] = useState<SignupFieldValues>({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<keyof SignupFormValues, string>>
  >({});
  const [referralCode, setReferralCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fromUrl = (params.ref ?? params.referral)?.toString();
    if (fromUrl?.trim()) {
      const code = fromUrl.trim().toUpperCase();
      setReferralCode(code);
      void savePendingReferralCode(code);
    }
  }, [params.ref, params.referral]);

  function validate(): boolean {
    const errors: Partial<Record<keyof SignupFormValues, string>> = {};
    if (values.phoneNumber.replace(/\D/g, "").length < 10) {
      errors.phoneNumber = "Enter a valid 10-digit mobile number";
    }
    const parsed = signupSchema.safeParse({
      ...values,
      phoneNumber: formatPhoneE164(values.phoneNumber),
      agreeToTerms: agreeToTerms ? true : (false as unknown as true),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SignupFormValues;
        if (!errors[key]) errors[key] = issue.message;
      }
    }
    setFieldErrors(errors);
    return parsed.success && !errors.phoneNumber;
  }

  async function handleSubmit() {
    if (!agreeToTerms) {
      setFieldErrors((prev) => ({
        ...prev,
        agreeToTerms: "You must agree to the Terms and Privacy Policy",
      }));
      return;
    }
    if (!validate()) return;
    const phoneNumber = formatPhoneE164(values.phoneNumber);
    const pending = {
      email: values.email.trim().toLowerCase(),
      phoneNumber,
      firstName: values.firstName.trim(),
      lastName: values.lastName.trim(),
      password: values.password,
      referralCode: referralCode.trim() ? referralCode.trim().toUpperCase() : undefined,
      agreeToTerms: true as const,
    };

    setIsLoading(true);
    const result = await runAuthAction(() => sendOtp(phoneNumber), setError);
    setIsLoading(false);

    if (result.ok) {
      await savePendingRegistration(pending);
      showToast("Verification code sent to your phone");
      router.push(`/verify-otp?flow=register&phone=${encodeURIComponent(phoneNumber)}`);
    }
  }

  return (
    <AuthPageShell
      title="Create your account"
      subtitle="Join Homeeigo for premium home services with AI-powered booking."
      badge="Get started"
      footer={
        <Pressable onPress={() => router.push("/login")}>
          <Text style={styles.footerLink}>
            Already have an account? <Text style={styles.footerLinkBold}>Sign in</Text>
          </Text>
        </Pressable>
      }
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <AuthTextField
            label="First name"
            value={values.firstName}
            onChangeText={(firstName) => setValues((v) => ({ ...v, firstName }))}
            errorMessage={fieldErrors.firstName}
            autoCapitalize="words"
            editable={!isLoading}
          />
          <AuthTextField
            label="Last name"
            value={values.lastName}
            onChangeText={(lastName) => setValues((v) => ({ ...v, lastName }))}
            errorMessage={fieldErrors.lastName}
            autoCapitalize="words"
            editable={!isLoading}
          />
          <AuthTextField
            label="Email"
            value={values.email}
            onChangeText={(email) => setValues((v) => ({ ...v, email }))}
            errorMessage={fieldErrors.email}
            keyboardType="email-address"
            editable={!isLoading}
          />
          <PhoneField
            value={values.phoneNumber}
            onChange={(phoneNumber) => setValues((v) => ({ ...v, phoneNumber }))}
            errorMessage={fieldErrors.phoneNumber}
            disabled={isLoading}
          />
          <AuthTextField
            label="Password"
            value={values.password}
            onChangeText={(password) => setValues((v) => ({ ...v, password }))}
            errorMessage={fieldErrors.password}
            secureTextEntry
            editable={!isLoading}
          />
          <AuthTextField
            label="Confirm password"
            value={values.confirmPassword}
            onChangeText={(confirmPassword) => setValues((v) => ({ ...v, confirmPassword }))}
            errorMessage={fieldErrors.confirmPassword}
            secureTextEntry
            editable={!isLoading}
          />
          <AuthTextField
            label="Referral code (optional)"
            value={referralCode}
            onChangeText={(t) => {
              const code = t.toUpperCase();
              setReferralCode(code);
              if (code.trim()) void savePendingReferralCode(code);
            }}
            editable={!isLoading}
          />

          <Pressable
            onPress={() => setAgreeToTerms((v) => !v)}
            style={styles.termsRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreeToTerms }}
          >
            <View style={[styles.checkbox, agreeToTerms && styles.checkboxOn]} />
            <Text style={styles.termsText}>
              I agree to the Terms of Service and Privacy Policy.
            </Text>
          </Pressable>
          {fieldErrors.agreeToTerms ? (
            <Text style={styles.error}>{fieldErrors.agreeToTerms}</Text>
          ) : null}

          {storeError ? <Text style={styles.error}>{storeError}</Text> : null}

          <Button
            title="Continue"
            onPress={() => void handleSubmit()}
            loading={isLoading}
            size="lg"
            style={styles.btnWrap}
          />

          <OAuthProviderButtons disabled={isLoading} />
        </ScrollView>
      </KeyboardAvoidingView>
    </AuthPageShell>
  );
}

const styles = StyleSheet.create({
  btnWrap: { marginTop: spacing.sm },
  error: { color: "#EF4444", marginBottom: 12 },
  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 12 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: "#94A3B8",
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  termsText: { flex: 1, color: "#64748B", fontSize: 13, lineHeight: 18 },
  footerLink: { textAlign: "center", color: "#64748B" },
  footerLinkBold: { color: "#2563EB", fontWeight: "700" },
});
