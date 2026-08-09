import { useCallback } from "react";
import { Platform } from "react-native";
import { getApiBaseUrl } from "@/lib/api-config";
import {
  completeDevMockCheckout,
  shouldUseDevMockCheckout,
  type RazorpaySuccessPayload,
} from "@/lib/razorpay-checkout-shared";

function getRazorpayKey(fallback?: string): string {
  return fallback ?? process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? "";
}

export function useRazorpayCheckout() {
  const openCheckout = useCallback(
    async (options: {
      key?: string;
      orderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      checkoutMode?: "razorpay" | "dev_mock";
      onSuccess: (payload: RazorpaySuccessPayload) => void | Promise<void>;
      onDismiss?: () => void;
      onFailure?: (message: string) => void;
    }) => {
      const key = getRazorpayKey(options.key);
      const useDevMock =
        options.checkoutMode === "dev_mock" || shouldUseDevMockCheckout(options.orderId, key);

      if (useDevMock) {
        await completeDevMockCheckout(getApiBaseUrl(), options.orderId, options.onSuccess);
        return;
      }

      if (Platform.OS === "web") {
        throw new Error("Use the partner web app for browser payments.");
      }

      if (!key) {
        throw new Error("Razorpay key missing. Set EXPO_PUBLIC_RAZORPAY_KEY_ID in .env.local.");
      }

      const RazorpayCheckout = (await import("react-native-razorpay")).default;

      try {
        const data = await RazorpayCheckout.open({
          key,
          order_id: options.orderId,
          currency: options.currency,
          name: options.name,
          description: options.description,
          theme: { color: "#3d6b4f" },
        });
        await options.onSuccess({
          razorpay_order_id: data.razorpay_order_id,
          razorpay_payment_id: data.razorpay_payment_id,
          razorpay_signature: data.razorpay_signature,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code ?? "")
            : "";
        if (message.toLowerCase().includes("cancel") || code === "2") {
          options.onDismiss?.();
          return;
        }
        options.onFailure?.(message);
        throw error;
      }
    },
    [],
  );

  return { openCheckout };
}
