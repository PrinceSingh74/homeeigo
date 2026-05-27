import { OnlineToggle } from "@/components/availability/OnlineToggle";

export default function AvailabilityPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Availability</h1>
        <p className="text-sm text-partner-muted">
          Control when you receive booking requests
        </p>
      </div>
      <OnlineToggle />
    </div>
  );
}
