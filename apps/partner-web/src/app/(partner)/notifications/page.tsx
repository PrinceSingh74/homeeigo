import { NotificationsCenter } from "@/components/notifications/NotificationsCenter";

export default function NotificationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Notifications</h1>
        <p className="text-sm text-partner-muted">
          Real-time alerts for bookings, earnings, payments, and reviews
        </p>
      </div>
      <NotificationsCenter />
    </div>
  );
}
