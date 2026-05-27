"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

type AdminState = {
  authenticated: boolean;
  adminName: string;
  setAuthenticated: (v: boolean) => void;
};

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      authenticated: false,
      adminName: "Operations Lead",
      setAuthenticated: (authenticated) => set({ authenticated }),
    }),
    { name: "homigo-admin-store" }
  )
);
