"use client";

import { UserCheck2 } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { PartnerButton } from "@/components/ui/PartnerButton";
import {
  usePartnerAttendanceQuery,
  usePartnerCheckInMutation,
  usePartnerCheckOutMutation,
} from "@/hooks/use-partner-os";

export default function AttendancePage() {
  const attendance = usePartnerAttendanceQuery();
  const checkIn = usePartnerCheckInMutation();
  const checkOut = usePartnerCheckOutMutation();
  const data = attendance.data;

  return (
    <HqPageShell
      title="Attendance Center"
      description="Check-in, check-out, and working hours from partner attendance sessions API."
      icon={UserCheck2}
      stats={[
        {
          label: "Check-in",
          value: data?.checkIn ? new Date(data.checkIn).toLocaleTimeString("en-IN") : "—",
        },
        {
          label: "Check-out",
          value: data?.isCheckedIn ? "Active session" : data?.checkOut ? new Date(data.checkOut).toLocaleTimeString("en-IN") : "—",
        },
        { label: "Working hours today", value: `${data?.workingHoursToday ?? 0}h` },
        { label: "Weekly attendance", value: data?.weeklyAttendance ?? 0 },
        { label: "Monthly attendance", value: data?.monthlyAttendance ?? 0 },
      ]}
    >
      <div className="flex flex-wrap gap-3">
        <PartnerButton onClick={() => checkIn.mutate()} disabled={checkIn.isPending || data?.isCheckedIn}>
          Check in
        </PartnerButton>
        <PartnerButton variant="outline" onClick={() => checkOut.mutate()} disabled={checkOut.isPending || !data?.isCheckedIn}>
          Check out
        </PartnerButton>
      </div>

      <section className="partner-card overflow-hidden">
        <div className="border-b border-partner-line px-4 py-3 font-semibold">Recent sessions</div>
        <div className="divide-y divide-partner-line">
          {(data?.sessions ?? []).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
              <span>{new Date(s.checkInAt).toLocaleString("en-IN")}</span>
              <span className="text-partner-muted">{s.durationHours != null ? `${s.durationHours}h` : "Open"}</span>
            </div>
          ))}
        </div>
      </section>
    </HqPageShell>
  );
}
