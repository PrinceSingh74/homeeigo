"use client";

import { Bell, Sparkles, MapPin, Tag } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { bookUrl } from "@/lib/booking-url";
import { useRouter } from "next/navigation";

const NOTIFICATIONS = [
  {
    id: "1",
    icon: Sparkles,
    title: "Your pro is on the way",
    body: "Rajesh will arrive in ~12 minutes for Home Cleaning.",
    action: bookUrl({ service: "cleaning" }),
    time: "2m ago",
  },
  {
    id: "2",
    icon: Tag,
    title: "New offer: COOL100",
    body: "Flat ₹100 off on AC Service — valid today only.",
    action: bookUrl({ service: "ac-service", promo: "COOL100" }),
    time: "1h ago",
  },
  {
    id: "3",
    icon: MapPin,
    title: "Service completed",
    body: "Plumbing job marked complete. Rate your experience.",
    action: bookUrl({ service: "plumbing" }),
    time: "Yesterday",
  },
];

export function NotificationsPanel({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const markNotificationsRead = useAppStore((s) => s.markNotificationsRead);
  const router = useRouter();

  return (
    <Modal open={open} onClose={closeOverlay} title="Notifications" size="md">
      <ul className="flex flex-col gap-3">
        {NOTIFICATIONS.map((n) => {
          const Icon = n.icon;
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => {
                  closeOverlay();
                  useAppStore.getState().markNotificationsRead();
                  router.push(n.action);
                }}
                className="flex w-full gap-3 rounded-2xl glass-card p-4 text-left transition hover:bg-primary/5"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                  <Icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-content">
                      {n.title}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted">
                      {n.time}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {n.body}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={() => {
          markNotificationsRead();
          showToast("All notifications marked as read", "success");
          closeOverlay();
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-primary hover:bg-primary/5"
      >
        <Bell size={16} />
        Mark all as read
      </button>
    </Modal>
  );
}
