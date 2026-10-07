import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock } from "lucide-react-native";
import { useState } from "react";
import { failureSentence } from "@/components/money/DataScreen";
import { KpiCard } from "@/components/KpiCard";
import { Block, Grid } from "@/components/money/DataScreen";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, T } from "@/components/ui";
import { K } from "@/hooks/money/queries";
import { count, formatDayTime, hoursText, humanise } from "@/lib/money-format";
import { pageOf } from "@/lib/money-series";
import { partnerApi } from "@/services/partner-api";
import type { PartnerAttendance } from "@/types/partner";

type Outcome = { tone: "success" | "danger"; text: string };

/**
 * Check-in and check-out (`POST /api/providers/me/attendance/check-in` / `check-out`). Each tap
 * ends in a sentence: what the server did, or its refusal ("No open attendance session"). Checking
 * in also puts the partner online — the server does that in the same call — so the result says so.
 */
export function useAttendanceActions() {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const settle = () => {
    for (const queryKey of [K.attendance, K.operations, K.provider, K.dashboard]) void qc.invalidateQueries({ queryKey });
  };
  const checkIn = useMutation({
    mutationFn: () => partnerApi.partnerOs.checkIn(),
    onMutate: () => setOutcome(null),
    onSuccess: (result) => setOutcome({ tone: "success", text: result.alreadyCheckedIn ? "You were already checked in." : "Checked in. You are now online." }),
    onError: (error) => setOutcome({ tone: "danger", text: failureSentence(error) }),
    onSettled: settle,
  });
  const checkOut = useMutation({
    mutationFn: () => partnerApi.partnerOs.checkOut(),
    onMutate: () => setOutcome(null),
    onSuccess: () => setOutcome({ tone: "success", text: "Checked out. Your online status has not changed." }),
    onError: (error) => setOutcome({ tone: "danger", text: failureSentence(error) }),
    onSettled: settle,
  });
  return { checkIn, checkOut, outcome };
}

const SESSIONS_PAGE = 8;

/**
 * What `GET /api/providers/me/attendance` sends, named for what it is. `weeklyAttendance` and
 * `monthlyAttendance` are counts of check-ins (since Sunday / since the 1st), not days.
 * `workingHoursToday` is not shown: the server fills it with the total of the latest closed
 * sessions, not today's hours.
 */
export function AttendanceBody({ attendance, outcome }: { attendance: PartnerAttendance; outcome: Outcome | null }) {
  const [shown, setShown] = useState(SESSIONS_PAGE);
  const sessions = Array.isArray(attendance.sessions) ? attendance.sessions : [];
  const { visible, hidden } = pageOf(sessions, shown);
  return (
    <>
      {outcome ? <Banner tone={outcome.tone} message={outcome.text} testID="attendance-outcome" /> : null}
      <Card testID="attendance-shift">
        <KeyValue label="Status" value={attendance.isCheckedIn ? "Checked in" : "Not checked in"} strong testID="attendance-status" />
        {attendance.isCheckedIn ? <KeyValue label="Checked in at" value={formatDayTime(attendance.checkIn)} /> : null}
        {!attendance.isCheckedIn && attendance.checkOut ? <KeyValue label="Last check-out" value={formatDayTime(attendance.checkOut)} /> : null}
        {attendance.workingHoursStart && attendance.workingHoursEnd ? (
          <KeyValue label="Your working hours" value={`${attendance.workingHoursStart} – ${attendance.workingHoursEnd}`} />
        ) : null}
      </Card>
      <Grid>
        <KpiCard label="Check-ins this week" value={count(attendance.weeklyAttendance)} />
        <KpiCard label="Check-ins this month" value={count(attendance.monthlyAttendance)} />
      </Grid>
      <Block title="Recent sessions" caption={sessions.length > 0 ? `Showing ${visible.length} of the latest ${sessions.length}. The server lists at most 30.` : undefined}>
        <Card>
          {sessions.length === 0 ? (
            <EmptyState icon={Clock} title="No sessions yet" message="Each check-in and check-out appears here with how long it lasted." testID="attendance-empty" />
          ) : (
            <>
              {visible.map((s, i) => (
                <ListRow
                  key={s.id}
                  icon={Clock}
                  title={formatDayTime(s.checkInAt)}
                  subtitle={`${s.checkOutAt ? `Checked out ${formatDayTime(s.checkOutAt)}` : "Still open"} · ${humanise(s.source)}`}
                  value={s.checkOutAt ? hoursText(s.durationHours) : null}
                  last={i === visible.length - 1 && hidden === 0}
                />
              ))}
              {hidden > 0 ? <Button label={`Show ${Math.min(SESSIONS_PAGE, hidden)} more`} variant="quiet" onPress={() => setShown((n) => n + SESSIONS_PAGE)} /> : null}
            </>
          )}
        </Card>
      </Block>
      <T kind="small">Checking in also puts you online. Checking out does not take you offline.</T>
    </>
  );
}
