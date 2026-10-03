import React, { useEffect, useState } from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { MapPin, Check, X, LocateFixed, Search, AlertTriangle } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { spacing, radius, type, screenPadding } from "@/lib/typography";
import { sheetHandle } from "@/lib/booking-ui";
import type { BackendAddress } from "@/types/backend";
import { buildAddressPayload, formatAddressLine } from "@/lib/addresses";
import { deviceFixFailureMessage, getDeviceFix } from "@/lib/device-location";
import { parityApi } from "@/services/core/parity-api";
import { useCreateAddressMutation } from "@/hooks/use-core-data";
import { useServiceability } from "@/hooks/use-booking-quote";
import { AuthApiError, getErrorMessage } from "@/lib/auth/errors";

/** The address a booking is priced and placed at. Coordinates are always the saved ones. */
export type SelectedAddress = {
  id: string;
  label: string;
  text: string;
  latitude: number;
  longitude: number;
};

/** A real, geocoded point the customer is confirming (GPS + reverse geocode, or a search result). */
export type AddressSeed = {
  latitude: number;
  longitude: number;
  formattedAddress: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

export function toSelectedAddress(a: BackendAddress): SelectedAddress | null {
  if (a.latitude == null || a.longitude == null) return null;
  return {
    id: a.id,
    label: a.label || "Address",
    text: formatAddressLine(a),
    latitude: a.latitude,
    longitude: a.longitude,
  };
}

type Props = {
  visible: boolean;
  onClose: () => void;
  addresses: BackendAddress[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (a: SelectedAddress) => void;
  /** Close this sheet and open the map/autocomplete picker (app/address/picker). */
  onRequestSearch: (notice?: string) => void;
  /** A result coming back from the picker; consumed into the confirm form. */
  pickedSeed: AddressSeed | null;
  onSeedConsumed: () => void;
  serviceCategory?: string;
};

const LABELS = ["Home", "Work", "Other"] as const;

export function BookingAddressSheet({
  visible,
  onClose,
  addresses,
  loading,
  selectedId,
  onSelect,
  onRequestSearch,
  pickedSeed,
  onSeedConsumed,
  serviceCategory,
}: Props) {
  const { colors: c } = useTheme();
  const createAddress = useCreateAddressMutation();
  const [seed, setSeed] = useState<AddressSeed | null>(null);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [label, setLabel] = useState<string>("Home");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const seedCoords = seed ? { latitude: seed.latitude, longitude: seed.longitude } : null;
  const service = useServiceability(seedCoords, serviceCategory);

  function openForm(s: AddressSeed) {
    setSeed(s);
    setLine1("");
    setLine2(s.formattedAddress ?? "");
    setCity(s.city ?? "");
    setStateName(s.state ?? "");
    setPincode((s.postalCode ?? "").replace(/\D/g, "").slice(0, 6));
    setFormError(null);
  }

  useEffect(() => {
    if (pickedSeed) {
      openForm(pickedSeed);
      onSeedConsumed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedSeed]);

  useEffect(() => {
    if (!visible) {
      setNotice(null);
      setLocating(false);
    }
  }, [visible]);

  async function locateMe() {
    Haptics.selectionAsync();
    setNotice(null);
    setLocating(true);
    const fix = await getDeviceFix();
    if (!fix.ok) {
      setLocating(false);
      // No permission / GPS → the map search is the fallback. Never a default point.
      onRequestSearch(deviceFixFailureMessage(fix.reason));
      return;
    }
    try {
      const geo = await parityApi.geo.reverse(fix.latitude, fix.longitude);
      openForm({
        latitude: fix.latitude,
        longitude: fix.longitude,
        formattedAddress: geo?.formattedAddress ?? "",
        city: geo?.city,
        state: geo?.state,
        postalCode: geo?.postalCode,
      });
      if (!geo) setNotice("We found your location but couldn't look up the street — please type it below.");
    } catch (error) {
      if (error instanceof AuthApiError && error.code === "OUT_OF_AREA") {
        setNotice("Your current location is outside the area we serve.");
      } else {
        // The GPS point is real; the customer types the address text for it.
        openForm({ latitude: fix.latitude, longitude: fix.longitude, formattedAddress: "" });
        setNotice("Couldn't look up the street for your location — please type it below.");
      }
    } finally {
      setLocating(false);
    }
  }

  async function saveAndUse() {
    if (!seed) return;
    const check = buildAddressPayload({
      latitude: seed.latitude,
      longitude: seed.longitude,
      line1,
      line2,
      city,
      state: stateName,
      pincode,
      label,
    });
    if (!check.ok) {
      setFormError(check.message);
      return;
    }
    if (service.state === "unserviceable") {
      setFormError("We don't serve this location yet, so it can't be used for a booking.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const created = await createAddress.mutateAsync(check.payload);
      if (created.queued || !created.address?.id) {
        setFormError("You're offline — connect to the internet to save this address and book.");
        return;
      }
      onSelect({
        id: created.address.id,
        label,
        text: [line1.trim(), line2.trim(), city.trim(), pincode.trim()].filter(Boolean).join(", "),
        latitude: seed.latitude,
        longitude: seed.longitude,
      });
      setSeed(null);
      onClose();
    } catch (error) {
      setFormError(getErrorMessage(error, "Couldn't save this address. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close address picker" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
          <View style={sheetHandle} />
          <View style={styles.header}>
            <Text style={[styles.title, { color: c.text }]}>
              {seed ? "Confirm address" : "Where do you need the service?"}
            </Text>
            <Pressable onPress={seed ? () => setSeed(null) : onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={22} color={c.textSecondary} />
            </Pressable>
          </View>

          {notice ? (
            <View style={[styles.notice, { backgroundColor: c.warning + "18" }]}>
              <AlertTriangle size={16} color={c.warning} />
              <Text style={[styles.noticeText, { color: c.text }]}>{notice}</Text>
            </View>
          ) : null}

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
            {!seed ? (
              <>
                <Pressable
                  onPress={() => void locateMe()}
                  disabled={locating}
                  style={[styles.action, { borderColor: c.primary }]}
                  accessibilityRole="button"
                >
                  {locating ? <ActivityIndicator color={c.primary} /> : <LocateFixed size={20} color={c.primary} />}
                  <Text style={[styles.actionText, { color: c.primary }]}>
                    {locating ? "Finding your location…" : "Use my current location"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onRequestSearch()}
                  style={[styles.action, { borderColor: c.border }]}
                  accessibilityRole="button"
                >
                  <Search size={20} color={c.text} />
                  <Text style={[styles.actionText, { color: c.text }]}>Search for an address</Text>
                </Pressable>

                <Text style={[styles.section, { color: c.textSecondary }]}>SAVED ADDRESSES</Text>
                {loading ? (
                  <ActivityIndicator color={c.primary} style={{ marginVertical: spacing.lg }} />
                ) : addresses.length === 0 ? (
                  <Text style={[styles.meta, { color: c.textSecondary }]}>
                    No saved addresses yet — use your location or search above.
                  </Text>
                ) : (
                  addresses.map((a) => {
                    const sel = toSelectedAddress(a);
                    const active = a.id === selectedId;
                    return (
                      <Pressable
                        key={a.id}
                        disabled={!sel}
                        onPress={() => {
                          if (!sel) return;
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          onSelect(sel);
                          onClose();
                        }}
                        style={[
                          styles.row,
                          {
                            borderColor: active ? c.primary : c.border,
                            backgroundColor: active ? c.primary + "12" : c.bg,
                            opacity: sel ? 1 : 0.5,
                          },
                        ]}
                      >
                        <MapPin size={20} color={active ? c.primary : c.textSecondary} />
                        <View style={styles.rowText}>
                          <Text style={[styles.label, { color: c.text }]}>{a.label || "Address"}</Text>
                          <Text style={[styles.meta, { color: c.textSecondary }]} numberOfLines={2}>
                            {sel ? formatAddressLine(a) : "No map location saved — add this address again."}
                          </Text>
                        </View>
                        {active ? (
                          <View style={[styles.check, { backgroundColor: c.primary }]}>
                            <Check size={14} color="#fff" strokeWidth={3} />
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })
                )}
              </>
            ) : (
              <>
                <ServiceabilityLine state={service} c={c} />
                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>House / flat no. & street *</Text>
                <TextInput value={line1} onChangeText={setLine1} placeholder="e.g. B-204, Palm Residency" placeholderTextColor={c.textSecondary} style={input} maxLength={200} />
                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>Area / locality</Text>
                <TextInput value={line2} onChangeText={setLine2} placeholder="Area, landmark" placeholderTextColor={c.textSecondary} style={input} maxLength={200} multiline />
                <View style={styles.twoCol}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>City *</Text>
                    <TextInput value={city} onChangeText={setCity} placeholderTextColor={c.textSecondary} style={input} maxLength={100} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>PIN code *</Text>
                    <TextInput value={pincode} onChangeText={(t) => setPincode(t.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad" placeholderTextColor={c.textSecondary} style={input} />
                  </View>
                </View>
                <Text style={[styles.fieldLabel, { color: c.textSecondary }]}>State *</Text>
                <TextInput value={stateName} onChangeText={setStateName} placeholderTextColor={c.textSecondary} style={input} maxLength={100} />
                <View style={styles.labels}>
                  {LABELS.map((l) => (
                    <Pressable
                      key={l}
                      onPress={() => setLabel(l)}
                      style={[styles.labelChip, label === l ? { backgroundColor: c.primary } : { borderColor: c.border, borderWidth: 1 }]}
                    >
                      <Text style={{ ...type.chip, color: label === l ? "#fff" : c.text }}>{l}</Text>
                    </Pressable>
                  ))}
                </View>
                {formError ? <Text style={[styles.error, { color: c.error }]}>{formError}</Text> : null}
                <Pressable
                  onPress={() => void saveAndUse()}
                  disabled={saving || service.state === "unserviceable" || service.state === "checking"}
                  style={[
                    styles.save,
                    { backgroundColor: c.primary, opacity: saving || service.state === "unserviceable" || service.state === "checking" ? 0.5 : 1 },
                  ]}
                  accessibilityRole="button"
                >
                  <Text style={styles.saveText}>{saving ? "Saving…" : "Save & use this address"}</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function ServiceabilityLine({
  state,
  c,
}: {
  state: ReturnType<typeof useServiceability>;
  c: ReturnType<typeof useTheme>["colors"];
}) {
  if (state.state === "idle") return null;
  if (state.state === "checking") {
    return <Text style={[styles.meta, { color: c.textSecondary, marginBottom: spacing.sm }]}>Checking if we serve this location…</Text>;
  }
  if (state.state === "serviceable") {
    return (
      <Text style={[styles.meta, { color: c.success, marginBottom: spacing.sm }]}>
        We serve this location{state.zones.length ? ` · ${state.zones[0]}` : ""}.
      </Text>
    );
  }
  if (state.state === "unserviceable") {
    return (
      <View style={[styles.notice, { backgroundColor: c.error + "14" }]}>
        <AlertTriangle size={16} color={c.error} />
        <Text style={[styles.noticeText, { color: c.text }]}>
          {state.reason === "outside_india"
            ? "This location is outside India — we can't serve it."
            : "We don't serve this area yet. Try a different address."}
        </Text>
      </View>
    );
  }
  return (
    <Pressable onPress={state.retry} style={{ marginBottom: spacing.sm }}>
      <Text style={[styles.meta, { color: c.warning }]}>{state.message} Tap to retry.</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: {
    borderTopLeftRadius: radius["2xl"],
    borderTopRightRadius: radius["2xl"],
    paddingHorizontal: screenPadding,
    paddingBottom: spacing["3xl"],
    maxHeight: "86%",
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  title: { ...type.title, fontSize: 19, flex: 1, paddingRight: spacing.md },
  list: { paddingBottom: spacing.xl },
  notice: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", padding: spacing.md, borderRadius: radius.md, marginBottom: spacing.md },
  noticeText: { ...type.small, flex: 1 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  actionText: { ...type.bodyBold },
  section: { ...type.caption, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    marginBottom: spacing.sm,
  },
  rowText: { flex: 1 },
  label: { ...type.bodyBold },
  meta: { ...type.caption, marginTop: 2 },
  check: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  fieldLabel: { ...type.caption, fontWeight: "700", marginTop: spacing.sm, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, ...type.body },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  labels: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  labelChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  error: { ...type.small, marginTop: spacing.md },
  save: { marginTop: spacing.lg, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  saveText: { ...type.bodyBold, color: "#fff" },
});
