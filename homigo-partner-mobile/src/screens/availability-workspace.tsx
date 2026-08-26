import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorBlock, HqCard, HqCardTitle, HqMuted, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const PAUSE = ["break", "personal", "travel", "other"] as const;

export function AvailabilityWorkspaceScreen() {
  const qc = useQueryClient();
  const ops = useQuery({ queryKey: ["partner", "operations"], queryFn: () => partnerApi.operations() });
  const [days, setDays] = useState<string[]>([...DAYS.slice(0, 5)]);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("18:00");
  const [breakStart, setBreakStart] = useState("13:00");
  const [breakEnd, setBreakEnd] = useState("14:00");
  const [maxDay, setMaxDay] = useState("5");
  const [maxConcurrent, setMaxConcurrent] = useState("2");
  const [radius, setRadius] = useState("5");
  const [regions, setRegions] = useState("");
  const [city, setCity] = useState("");
  const [lat, setLat] = useState<number | undefined>();
  const [lng, setLng] = useState<number | undefined>();
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    const d = ops.data;
    if (!d) return;
    setDays(d.workingDays.length ? d.workingDays : [...DAYS.slice(0, 5)]);
    setStart(d.workingHoursStart ?? "09:00");
    setEnd(d.workingHoursEnd ?? "18:00");
    setBreakStart(d.breakWindows[0]?.start ?? "13:00");
    setBreakEnd(d.breakWindows[0]?.end ?? "14:00");
    setMaxDay(String(d.maxJobsPerDay ?? 5));
    setMaxConcurrent(String(d.maxConcurrentJobs ?? 2));
    setRadius(String(d.serviceRadiusKm ?? 5));
    setRegions(d.serviceRegions.join(", "));
    setCity(d.city ?? "");
    setLat(d.baseLatitude ?? undefined);
    setLng(d.baseLongitude ?? undefined);
  }, [ops.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
    void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
    void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
  };

  const toggle = useMutation({
    mutationFn: (online: boolean) => partnerApi.setOnline(online),
    onSuccess: invalidate,
  });
  const pause = useMutation({
    mutationFn: (reason: string) => partnerApi.pause(reason),
    onSuccess: invalidate,
  });
  const resume = useMutation({
    mutationFn: () => partnerApi.resume(),
    onSuccess: invalidate,
  });
  const save = useMutation({
    mutationFn: async () => {
      await partnerApi.updateSettings({
        workingDays: days,
        workingHoursStart: start,
        workingHoursEnd: end,
        breakWindows: [{ start: breakStart, end: breakEnd }],
        maxJobsPerDay: Number(maxDay),
        maxConcurrentJobs: Number(maxConcurrent),
      });
      await partnerApi.updateServiceArea({
        city: city || undefined,
        serviceRegions: regions.split(",").map((s) => s.trim()).filter(Boolean),
        serviceRadiusKm: Number(radius),
        baseLatitude: lat,
        baseLongitude: lng,
      });
    },
    onSuccess: invalidate,
  });

  async function useGps() {
    setGeoError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== "granted") {
      setGeoError("Location permission denied. Search or type an area instead.");
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLat(pos.coords.latitude);
      setLng(pos.coords.longitude);
    } catch {
      setGeoError("GPS unavailable. Enter your service area manually.");
    }
  }

  if (ops.isLoading) {
    return (
      <PartnerScreen title="Availability" subtitle="When and where you work" showBack>
        <LoadingBlock />
      </PartnerScreen>
    );
  }
  if (ops.isError) {
    return (
      <PartnerScreen title="Availability" subtitle="When and where you work" showBack>
        <ErrorBlock message="Could not load availability." />
      </PartnerScreen>
    );
  }

  const d = ops.data!;
  const online = d.uiOnline && !d.isPaused && !d.isSuspended;
  const mapUri =
    lat != null && lng != null
      ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=13&size=640x360&markers=${lat},${lng},red-pushpin`
      : null;

  return (
    <PartnerScreen title="Availability" subtitle="Online, schedule, capacity, and service areas" showBack>
      {d.isSuspended ? (
        <HqCard>
          <HqCardTitle>Account restricted</HqCardTitle>
          <HqMuted>{d.suspendedMessage ?? "Contact Support to restore assignments."}</HqMuted>
        </HqCard>
      ) : (
        <HqCard>
          <HqCardTitle>{online ? "Online" : d.isPaused ? "Paused" : "Offline"}</HqCardTitle>
          <HqMuted>
            {online
              ? `Available for jobs · ${d.capacity.currentJobs}/${d.capacity.maxConcurrentJobs} capacity · ${d.preferredAreaLabel}`
              : d.isPaused
                ? "New offers are paused. Current jobs continue."
                : "You're offline and won't receive new job offers."}
          </HqMuted>
          {d.readiness.blockers.map((b) => (
            <Text key={b.code} style={styles.warn}>{b.message}</Text>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={d.isPaused ? "Resume" : online ? "Go Offline" : "Go Online"}
            onPress={() => (d.isPaused ? resume.mutate() : toggle.mutate(!online))}
            disabled={toggle.isPending || resume.isPending}
            style={[styles.cta, online || d.isPaused ? styles.ctaOff : styles.ctaOn]}
          >
            <Text style={styles.ctaText}>{d.isPaused ? "Resume" : online ? "Go Offline" : "Go Online"}</Text>
          </Pressable>
          {online ? (
            <View style={styles.rowWrap}>
              {PAUSE.map((r) => (
                <Pressable key={r} onPress={() => pause.mutate(r)} style={styles.chip}>
                  <Text style={styles.chipText}>Pause · {r}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </HqCard>
      )}

      <HqCard>
        <HqCardTitle>Capacity</HqCardTitle>
        {ops.isLoading ? (
          <LoadingBlock />
        ) : (
          <>
            <StatRow label="Jobs" value={`${d.capacity.currentJobs} / ${d.capacity.maxConcurrentJobs}`} />
            <StatRow label="Slots" value={String(d.capacity.availableSlots)} />
            <StatRow label="Utilization" value={`${d.capacity.utilization}%`} />
            <StatRow
              label="Next available"
              value={
                d.capacity.nextAvailableAt
                  ? new Date(d.capacity.nextAvailableAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
                  : "—"
              }
            />
          </>
        )}
      </HqCard>

      <HqCard>
        <HqCardTitle>Working days</HqCardTitle>
        <View style={styles.rowWrap}>
          {DAYS.map((day) => {
            const on = days.includes(day);
            return (
              <Pressable
                key={day}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${day}${on ? ", selected" : ""}`}
                onPress={() => setDays((prev) => (prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]))}
                style={[styles.day, on && styles.dayOn]}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]}>{day[0]}</Text>
              </Pressable>
            );
          })}
        </View>
        {days.length === 0 ? <EmptyState message="Set your working days and hours." /> : null}
      </HqCard>

      <HqCard>
        <HqCardTitle>Hours & break</HqCardTitle>
        <Text style={styles.label}>Start</Text>
        <TextInput value={start} onChangeText={setStart} style={styles.input} placeholder="09:00" />
        <Text style={styles.label}>End</Text>
        <TextInput value={end} onChangeText={setEnd} style={styles.input} placeholder="18:00" />
        <Text style={styles.label}>Break</Text>
        <View style={styles.row}>
          <TextInput value={breakStart} onChangeText={setBreakStart} style={[styles.input, styles.flex]} placeholder="13:00" />
          <TextInput value={breakEnd} onChangeText={setBreakEnd} style={[styles.input, styles.flex]} placeholder="14:00" />
        </View>
        <Text style={styles.label}>Max jobs / day</Text>
        <TextInput value={maxDay} onChangeText={setMaxDay} keyboardType="number-pad" style={styles.input} />
        <Text style={styles.label}>Max concurrent</Text>
        <TextInput value={maxConcurrent} onChangeText={setMaxConcurrent} keyboardType="number-pad" style={styles.input} />
      </HqCard>

      <HqCard>
        <HqCardTitle>Service areas</HqCardTitle>
        {mapUri ? <Image source={{ uri: mapUri }} style={styles.map} /> : <HqMuted>No map pin yet — use current location or type an area.</HqMuted>}
        <Pressable accessibilityRole="button" accessibilityLabel="Use current location" onPress={() => void useGps()} style={styles.secondary}>
          <Text style={styles.secondaryText}>Use current location</Text>
        </Pressable>
        {geoError ? <Text style={styles.warn}>{geoError}</Text> : null}
        <Text style={styles.label}>City</Text>
        <TextInput value={city} onChangeText={setCity} style={styles.input} placeholder="Gurugram" />
        <Text style={styles.label}>Preferred areas</Text>
        <TextInput value={regions} onChangeText={setRegions} style={styles.input} placeholder="Sector 45, Sector 46" />
        <Text style={styles.label}>Radius (km)</Text>
        <TextInput value={radius} onChangeText={setRadius} keyboardType="decimal-pad" style={styles.input} />
      </HqCard>

      <Pressable accessibilityRole="button" accessibilityLabel="Save changes" onPress={() => save.mutate()} disabled={save.isPending} style={styles.save}>
        <Text style={styles.ctaText}>{save.isPending ? "Saving…" : "Save changes"}</Text>
      </Pressable>
      {save.isError ? <Text style={styles.warn}>{save.error instanceof Error ? save.error.message : "Could not save"}</Text> : null}
      {toggle.isError ? <Text style={styles.warn}>{toggle.error instanceof Error ? toggle.error.message : "Could not update status"}</Text> : null}
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  cta: { marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: "center", minHeight: 44, justifyContent: "center" },
  ctaOn: { backgroundColor: partnerColors.success },
  ctaOff: { backgroundColor: partnerColors.textMuted },
  ctaText: { color: "#fff", fontWeight: "700" },
  chip: { marginTop: 8, marginRight: 8, borderRadius: 20, borderWidth: 1, borderColor: partnerColors.line, paddingHorizontal: 12, minHeight: 44, justifyContent: "center" },
  chipText: { fontSize: 12, fontWeight: "600", color: partnerColors.text },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", marginTop: 8 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  day: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: partnerColors.line, alignItems: "center", justifyContent: "center", marginRight: 8, marginBottom: 8 },
  dayOn: { backgroundColor: partnerColors.primary, borderColor: partnerColors.primary },
  dayText: { fontWeight: "700", color: partnerColors.textMuted },
  dayTextOn: { color: "#fff" },
  label: { marginTop: 10, fontSize: 12, color: partnerColors.textMuted },
  input: { marginTop: 6, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, backgroundColor: "#fff", color: partnerColors.text },
  map: { width: "100%", height: 180, borderRadius: 12, marginBottom: 10 },
  secondary: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  secondaryText: { fontWeight: "700", color: partnerColors.text },
  save: { marginTop: 8, marginBottom: 24, backgroundColor: partnerColors.primary, borderRadius: 12, minHeight: 48, alignItems: "center", justifyContent: "center" },
  warn: { marginTop: 8, color: partnerColors.warning, fontSize: 13 },
});
