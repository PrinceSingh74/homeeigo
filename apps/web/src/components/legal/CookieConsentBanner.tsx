"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiRequest } from "@/services/auth/api-client";

const STORAGE_KEY = "homigo_cookie_consent";
const CONSENT_CENTER = "/legal/cookies";

export function CookieConsentBanner() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  async function record(granted: boolean) {
    localStorage.setItem(STORAGE_KEY, granted ? "granted" : "declined");
    setVisible(false);
    try {
      await apiRequest("/api/legal/consent/cookies", {
        method: "POST",
        body: { granted },
      });
    } catch {
      // Non-blocking — preference stored locally
    }
  }

  // The Cookie Preferences Center offers the same choices with more detail, and
  // the fixed banner would sit on top of its save bar.
  if (!visible || pathname === CONSENT_CENTER) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[120] border-t border-line bg-canvas/95 p-4 shadow-e5 backdrop-blur-md sm:bottom-4 sm:mx-auto sm:max-w-xl sm:rounded-2xl sm:border"
    >
      <p className="text-sm text-content">
        We use essential cookies to keep you signed in and optional cookies to improve HOMEEIGO.{" "}
        <Link
          href="/legal/cookies"
          className="rounded-sm font-semibold text-[#1B5E4F] underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-emerald-500/60 dark:text-emerald-300"
        >
          Cookie Policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void record(true)}
          className="inline-flex min-h-11 items-center rounded-xl bg-[#1B5E4F] px-4 text-sm font-semibold text-white outline-none transition-colors hover:bg-[#164a3f] focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => void record(false)}
          className="inline-flex min-h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold text-content outline-none transition-colors hover:border-[#1B5E4F]/40 hover:text-[#1B5E4F] focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas dark:hover:text-emerald-300"
        >
          Decline optional
        </button>
      </div>
    </div>
  );
}
