import { create } from "zustand";
import type { GeoAddress } from "@/services/core/parity-api";

/** Holds the address chosen in the geo picker so the opening screen can read it after navigating back. */
type AddressPickState = {
  picked: GeoAddress | null;
  setPicked: (a: GeoAddress | null) => void;
};

export const useAddressPickStore = create<AddressPickState>((set) => ({
  picked: null,
  setPicked: (picked) => set({ picked }),
}));
