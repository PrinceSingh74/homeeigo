"use client";

import { create } from "zustand";

export type ToastType = "success" | "error" | "info";

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

type ToastState = {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType, durationMs?: number) => void;
  dismissToast: (id: string) => void;
};

const DEFAULT_DURATION = 4000;

export const useToastStore = create<ToastState>()((set, get) => ({
  toasts: [],
  showToast: (message, type = "info", durationMs = DEFAULT_DURATION) => {
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let added = false;
    set((state) => {
      const duplicate = state.toasts.some(
        (t) => t.message === message && t.type === type,
      );
      if (duplicate) return state;
      added = true;
      const next = [...state.toasts, { id, message, type }];
      return { toasts: next.length > 5 ? next.slice(-5) : next };
    });
    if (added && durationMs > 0) {
      window.setTimeout(() => get().dismissToast(id), durationMs);
    }
  },
  dismissToast: (id) =>
    set((state) => {
      if (!state.toasts.some((t) => t.id === id)) return state;
      return { toasts: state.toasts.filter((t) => t.id !== id) };
    }),
}));
