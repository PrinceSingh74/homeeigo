import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { LocateFixed } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chips } from "@/components/account/controls";
import { AccountScreen, ErrorState, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { OnlineSwitch } from "@/components/home/OnlineSwitch";
import { Banner, Button, Card, Field, KeyValue, Pill, T } from "@/components/ui";
import { useAuthed, useOperationsQuery, usePullRefresh } from "@/hooks/account/queries";
import { LIMITS, WORKING_DAYS, buildAvailabilityPatch, formFromServer, type AvailabilityForm, type AvailabilityServer } from "@/lib/availability-form";
import { errorSentence } from "@/lib/error-sentence";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerOperations } from "@/types/partner";

const DAY_NAMES: Record<(typeof WORKING_DAYS)[number], string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function serverOf(d: PartnerOperations): AvailabilityServer {
  return {
    workingDays: d.workingDays,
    workingHoursStart: d.workingHoursStart,
    workingHoursEnd: d.workingHoursEnd,
    breakWindows: d.breakWindows,
    maxJobsPerDay: d.maxJobsPerDay,
    maxConcurrentJobs: d.maxConcurrentJobs,
    serviceRadiusKm: d.serviceRadiusKm,
    serviceRegions: d.serviceRegions,
    city: d.city,
    baseLatitude: d.baseLatitude,
    baseLongitude: d.baseLongitude,
  };
}

/**
 * When and where the partner works. Every field shows what the server has — a setting the server
 * does not have is an empty field with its help text, never a made-up default — and saving sends
 * only what the partner changed (`lib/availability-form.ts`).
 */
export function AvailabilityWorkspaceScreen() {
  const qc = useQueryClient();
  const authed = useAuthed();
  const ops = useOperationsQuery();
  const d = ops.data;
  const [form, setForm] = useState<AvailabilityForm | null>(null);
  const [geo, setGeo] = useState<ActionResult>(null);
  const [locating, setLocating] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const [showErrors, setShowErrors] = useState(false);

  // The form follows the server until the partner starts typing; after a save it follows it again.
  const dirty = useRef(false);
  useEffect(() => {
    if (d && !dirty.current) setForm(formFromServer(serverOf(d)));
  }, [d]);
  const edit = (patch: Partial<AvailabilityForm>) => {
    dirty.current = true;
    setResult(null);
    setForm((f) => (f ? { ...f, ...patch } : f));
  };

  const zones = useQuery({
    queryKey: ["partner", "service-area-zones", d?.baseLatitude ?? null, d?.baseLongitude ?? null],
    queryFn: () => partnerApi.serviceAreaZones(),
    enabled: authed && d?.baseLatitude != null && d?.baseLongitude != null,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const { refreshing, onRefresh } = usePullRefresh(ops, zones);

  const patch = d && form ? buildAvailabilityPatch(form, serverOf(d)) : null;
  const save = useMutation({
    mutationFn: async () => {
      if (!patch) return [] as string[];
      const done: string[] = [];
      // Two endpoints: each is sent only if its fields changed, and a failure names what was NOT saved.
      if (patch.settings) {
        await partnerApi.updateSettings(patch.settings);
        done.push("Working hours and job limits saved.");
      }
      if (patch.serviceArea) {
        try {
          await partnerApi.updateServiceArea(patch.serviceArea);
          done.push("Service area saved.");
        } catch (e) {
          throw new Error(`${done.length ? `${done.join(" ")} ` : ""}Your service area was not saved: ${errorSentence(e)}`);
        }
      }
      return done;
    },
    onMutate: () => setResult(null),
    onSuccess: async (done) => {
      dirty.current = false;
      setShowErrors(false);
      await Promise.all([qc.invalidateQueries({ queryKey: ["partner", "operations"] }), qc.invalidateQueries({ queryKey: ["partner", "provider"] }), qc.invalidateQueries({ queryKey: ["partner", "dispatch-eligibility"] })]);
      setResult({ tone: "success", message: done.join(" ") });
    },
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
      setResult(failure(e, "Your changes could not be saved."));
    },
  });

  async function useCurrentLocation() {
    setGeo(null);
    setLocating(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setGeo({ tone: "warning", message: "Location access is off. Allow it in your phone's settings to set your base from where you are." });
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      edit({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      setGeo({ tone: "info", message: "Your current location will be saved as your base when you save changes." });
    } catch {
      setGeo({ tone: "warning", message: "Your phone could not get a location just now. Try again outdoors." });
    } finally {
      setLocating(false);
    }
  }

  if (ops.isLoading || (d && !form)) {
    return (
      <AccountScreen title="Availability">
        <RowsSkeleton rows={3} label="Loading your availability" />
        <RowsSkeleton rows={5} />
      </AccountScreen>
    );
  }
  if (!d || !form || !patch) {
    return (
      <AccountScreen title="Availability" refreshing={refreshing} onRefresh={onRefresh}>
        <ErrorState error={ops.error} title="Your availability could not be loaded" onRetry={() => void ops.refetch()} />
      </AccountScreen>
    );
  }

  const errors = showErrors ? patch.errors : {};
  const hasErrors = Object.keys(patch.errors).length > 0;
  const nothingToSave = !patch.settings && !patch.serviceArea;
  const baseSet = form.lat != null && form.lng != null;
  const baseChanged = baseSet && (form.lat !== d.baseLatitude || form.lng !== d.baseLongitude);

  return (
    <AccountScreen
      title="Availability"
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        <Button
          label="Save changes"
          onPress={() => {
            setShowErrors(true);
            if (!nothingToSave) save.mutate();
          }}
          loading={save.isPending}
          disabled={patch.unchanged}
          hint={patch.unchanged ? "Nothing has been changed." : hasErrors && showErrors ? "Fix the fields marked above. The rest will be saved." : null}
          testID="availability-save"
        />
      }
    >
      <OnlineSwitch showPause />

      <Card testID="availability-capacity">
        <View style={styles.stack}>
          <View style={styles.head}>
            <T kind="heading" accessibilityRole="header" style={styles.flex}>
              Capacity right now
            </T>
            {d.capacity.capacityFull ? <Pill label="Full" tone="warning" /> : null}
          </View>
          <KeyValue label="Jobs in hand" value={`${d.capacity.currentJobs} of ${d.capacity.maxConcurrentJobs}`} />
          <KeyValue label="Jobs today" value={d.capacity.maxJobsPerDay != null ? `${d.capacity.jobsToday} of ${d.capacity.maxJobsPerDay}` : String(d.capacity.jobsToday)} />
          <KeyValue label="Free slots" value={String(d.capacity.availableSlots)} />
          {d.capacity.nextAvailableAt ? <KeyValue label="Next free at" value={new Date(d.capacity.nextAvailableAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} /> : null}
        </View>
      </Card>

      <Card testID="availability-hours">
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Working days and hours
          </T>
          <T kind="small">Times are in your time zone ({d.timezone}), in 24-hour form.</T>
          <Chips
            label="Working days"
            multiple
            testID="availability-day"
            options={WORKING_DAYS.map((day) => ({ id: day, label: day, accessibilityLabel: DAY_NAMES[day] }))}
            value={form.days as Array<(typeof WORKING_DAYS)[number]>}
            onToggle={(day) => edit({ days: form.days.includes(day) ? form.days.filter((x) => x !== day) : [...form.days, day] })}
          />
          {form.days.length === 0 && !errors.days ? <T kind="small">No working days are set. Choose the days you take jobs.</T> : null}
          {errors.days ? (
            <T kind="small" tone="danger" accessibilityRole="alert">
              {errors.days}
            </T>
          ) : null}
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Field label="Start time" value={form.start} onChangeText={(start) => edit({ start })} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} testID="availability-start" />
            </View>
            <View style={styles.flex}>
              <Field label="End time" value={form.end} onChangeText={(end) => edit({ end })} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} testID="availability-end" />
            </View>
          </View>
          {errors.hours ? (
            <T kind="small" tone="danger" accessibilityRole="alert">
              {errors.hours}
            </T>
          ) : !d.workingHoursStart || !d.workingHoursEnd ? (
            <T kind="small">No working hours are set. Enter both times, for example 09:00 and 18:00.</T>
          ) : null}
          <View style={styles.pair}>
            <View style={styles.flex}>
              <Field label="Break starts" value={form.breakStart} onChangeText={(breakStart) => edit({ breakStart })} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} testID="availability-break-start" />
            </View>
            <View style={styles.flex}>
              <Field label="Break ends" value={form.breakEnd} onChangeText={(breakEnd) => edit({ breakEnd })} placeholder="HH:MM" keyboardType="numbers-and-punctuation" maxLength={5} testID="availability-break-end" />
            </View>
          </View>
          {errors.break ? (
            <T kind="small" tone="danger" accessibilityRole="alert">
              {errors.break}
            </T>
          ) : (
            <T kind="small">Optional. Leave both empty for no break.</T>
          )}
          {d.breakWindows.length > 1 ? (
            <T kind="small" testID="availability-more-breaks">
              {`You have ${d.breakWindows.length - 1} more break ${d.breakWindows.length - 1 === 1 ? "window" : "windows"} (${d.breakWindows
                .slice(1)
                .map((w) => `${w.start} to ${w.end}`)
                .join(", ")}). This screen changes the first one only; the others are kept as they are.`}
            </T>
          ) : null}
        </View>
      </Card>

      <Card testID="availability-limits">
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Job limits
          </T>
          <Field
            label="Most jobs in one day"
            value={form.maxDay}
            onChangeText={(maxDay) => edit({ maxDay })}
            keyboardType="number-pad"
            maxLength={2}
            error={errors.maxDay}
            help={`${LIMITS.jobsPerDay.min} to ${LIMITS.jobsPerDay.max}. Leave empty for no daily limit.`}
            testID="availability-max-day"
          />
          <Field
            label="Most jobs at the same time"
            value={form.maxAtOnce}
            onChangeText={(maxAtOnce) => edit({ maxAtOnce })}
            keyboardType="number-pad"
            maxLength={2}
            error={errors.maxAtOnce}
            help={`${LIMITS.jobsAtOnce.min} to ${LIMITS.jobsAtOnce.max}.`}
            testID="availability-max-at-once"
          />
        </View>
      </Card>

      <Card testID="availability-area">
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Service area
          </T>
          <Field label="City" value={form.city} onChangeText={(city) => edit({ city })} maxLength={80} error={errors.city} help={d.city ? undefined : "No city is set."} testID="availability-city" />
          <Field label="Areas you prefer" value={form.areas} onChangeText={(areas) => edit({ areas })} error={errors.areas} help="Separate areas with commas. Up to 20." testID="availability-areas" />
          <Field
            label="Travel radius in km"
            value={form.radius}
            onChangeText={(radius) => edit({ radius })}
            keyboardType="decimal-pad"
            maxLength={4}
            error={errors.radius}
            help={d.serviceRadiusKm == null ? `No radius is set. Enter ${LIMITS.radiusKm.min} to ${LIMITS.radiusKm.max}.` : `${LIMITS.radiusKm.min} to ${LIMITS.radiusKm.max}.`}
            testID="availability-radius"
          />
          <KeyValue label="Base location" value={baseChanged ? "New location, not saved yet" : baseSet ? "Set" : "Not set"} />
          <Button label="Use my current location as base" variant="secondary" icon={LocateFixed} onPress={() => void useCurrentLocation()} loading={locating} testID="availability-use-location" />
          <ResultBanner result={geo} testID="availability-geo" />
        </View>
      </Card>

      {d.baseLatitude != null && d.baseLongitude != null ? (
        <Card testID="availability-zones">
          <View style={styles.stack}>
            <T kind="heading" accessibilityRole="header">
              Service zones near your base
            </T>
            {zones.isLoading ? (
              <T kind="small">Loading zones…</T>
            ) : zones.isError ? (
              <Banner tone="warning" message={errorSentence(zones.error, "Zones could not be loaded.")} action={<Button label="Try again" variant="secondary" onPress={() => void zones.refetch()} />} />
            ) : (zones.data ?? []).length === 0 ? (
              <T kind="small">There are no HOMEEIGO service zones near your saved base.</T>
            ) : (
              (zones.data ?? []).map((z) => <KeyValue key={z.id} label={z.name} value={[z.zoneType.replace(/_/g, " ").toLowerCase(), z.city].filter(Boolean).join(" · ")} />)
            )}
          </View>
        </Card>
      ) : null}

      <ResultBanner result={result} testID="availability-result" />
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1 },
  pair: { flexDirection: "row", gap: space.md },
});
