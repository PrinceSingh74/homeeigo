"use client";

import { Headphones, Phone } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";

const SUPPORT_PHONE = "+918000123456";

export function SupportModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const requestSupportCallback = useAppStore((s) => s.requestSupportCallback);
  const supportQueued = useAppStore((s) => s.supportCallbackQueued);

  return (
    <Modal open={open} onClose={closeOverlay} title="24/7 Support" size="md">
      <p className="text-sm text-muted">
        Priority help for bookings, payments, and service issues.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        <li>
          <button
            type="button"
            onClick={() => {
              requestSupportCallback();
              closeOverlay();
            }}
            disabled={supportQueued}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-4 text-left transition hover:bg-primary/5 disabled:opacity-70"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <Phone size={20} />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">
                {supportQueued ? "Callback scheduled" : "Request a call back"}
              </span>
              <span className="block text-xs text-muted">Within 5 minutes</span>
            </span>
          </button>
        </li>
        <li>
          <a
            href={`tel:${SUPPORT_PHONE}`}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-4 text-left transition hover:bg-primary/5"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-success/10 text-success">
              <Headphones size={20} />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Call support</span>
              <span className="block text-xs text-muted">1800-123-456 · 24/7</span>
            </span>
          </a>
        </li>
      </ul>
    </Modal>
  );
}
