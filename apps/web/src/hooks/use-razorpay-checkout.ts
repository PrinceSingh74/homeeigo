"use client";

import { useCallback } from "react";
import {
  completeDevMockCheckout,
  shouldUseDevMockCheckout,
  type RazorpaySuccessPayload,
} from "@/lib/razorpay-checkout-shared";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, handler: (response: { error?: { description?: string } }) => void) => void;
    };
  }
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

function resolveApiBase() {
  return (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function loadRazorpayScript() {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${RAZORPAY_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(!!window.Razorpay), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = RAZORPAY_SCRIPT;
    script.async = true;
    script.onload = () => resolve(!!window.Razorpay);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

export function useRazorpayCheckout() {
  const openCheckout = useCallback(
    async (options: {
      key: string;
      orderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      checkoutMode?: "razorpay" | "dev_mock";
      prefill?: { email?: string; contact?: string; name?: string };
      onSuccess: (payload: RazorpaySuccessPayload) => void | Promise<void>;
      onDismiss?: () => void;
      onFailure?: (message: string) => void;
    }) => {
      const useDevMock =
        options.checkoutMode === "dev_mock" || shouldUseDevMockCheckout(options.orderId, options.key);

      if (useDevMock) {
        if (process.env.NODE_ENV === "production") {
          throw new Error(
            "Payment gateway is not configured on the server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend .env.",
          );
        }
        await completeDevMockCheckout(resolveApiBase(), options.orderId, options.onSuccess);
        return;
      }

      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) throw new Error("Razorpay SDK failed to load. Check your network connection.");

      const razorpay = new window.Razorpay({
        key: options.key,
        order_id: options.orderId,
        currency: options.currency,
        name: options.name,
        description: options.description,
        prefill: options.prefill,
        theme: { color: "#2563EB" },
        handler: options.onSuccess,
        modal: { ondismiss: options.onDismiss },
      });

      razorpay.on("payment.failed", (response) => {
        const message =
          response.error?.description ??
          "Payment could not be completed. Try UPI success@razorpay in test mode or another method.";
        options.onFailure?.(message);
      });

      razorpay.open();
    },
    [],
  );

  return { openCheckout };
}
