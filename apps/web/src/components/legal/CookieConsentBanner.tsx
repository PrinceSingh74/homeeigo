"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiRequest } from "@/services/auth/api-client";

const STORAGE_KEY = "homigo_cookie_consent";

export function CookieConsentBanner() {
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

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="fixed inset-x-0 bottom-0 z-[120] border-t border-line bg-canvas/95 p-4 shadow-e5 backdrop-blur-md sm:bottom-4 sm:mx-auto sm:max-w-xl sm:rounded-2xl sm:border"
    >
      <p className="text-sm text-content">
        We use essential cookies to keep you signed in and optional cookies to improve HOMEEIGO.{" "}
        <Link href="/legal/cookies" className="font-semibold text-primary hover:underline">
          Cookie Policy
        </Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void record(true)}
          className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => void record(false)}
          className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-content"
        >
          Decline optional
        </button>
      </div>
    </div>
  );
}
