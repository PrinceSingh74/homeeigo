"use client";

import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";

/**
 * The way to reach support that exists: a ticket (each carries the server's response deadline).
 *
 * Removed: a "request a call back" button promising a call within minutes, which only set a flag
 * in this browser and told nobody; a phone tile that printed one placeholder number and dialled a
 * different one; and the round-the-clock title. A phone line can come back when there is a real
 * number to print.
 */
export function SupportModal({ open }: { open: boolean }) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);

  return (
    <Modal open={open} onClose={closeOverlay} title="Support" size="md">
      <p className="text-sm text-muted">
        Help with bookings, payments, and service issues.
      </p>

      <ul className="mt-5 flex flex-col gap-3">
        <li>
          <Link
            href="/support"
            onClick={closeOverlay}
            className="flex w-full items-center gap-3 rounded-2xl glass-card px-4 py-4 text-left transition hover:bg-primary/5"
          >
            <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
              <LifeBuoy size={20} />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-content">Help center</span>
              <span className="block text-xs text-muted">FAQs & support tickets</span>
            </span>
          </Link>
        </li>
      </ul>
    </Modal>
  );
}
