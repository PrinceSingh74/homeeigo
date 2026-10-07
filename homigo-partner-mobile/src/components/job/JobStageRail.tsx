import { Card, StageRail, T } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { jobRailSteps, type JobRailInput } from "@/lib/job-screen";
import { space } from "@/theme/tokens";

/**
 * The job as a sequence — the screen's signature element: Accepted → On the way → Arrived →
 * Started → Completed, each with the time the server recorded, the current one filled.
 *
 * It draws the booking it is given and nothing else. An arrival the server took back (a reschedule
 * or a reassignment clears `arrivedAt`) reads "not yet" again; see `jobRailSteps`.
 */
export function JobStageRail({ booking }: { booking: JobRailInput }) {
  const steps = jobRailSteps(booking, formatDateTime);
  return (
    <Card>
      <T kind="heading" accessibilityRole="header" style={{ marginBottom: space.md }}>
        Job progress
      </T>
      <StageRail testID="job-stage-rail" steps={steps} />
    </Card>
  );
}
