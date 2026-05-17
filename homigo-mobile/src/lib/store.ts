import { create } from "zustand";

interface AppState {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  userLocation: string;
  setUserLocation: (location: string) => void;
  selectedService: string | null;
  setSelectedService: (service: string | null) => void;
  cart: any[];
  addToCart: (item: any) => void;
  removeFromCart: (itemId: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isDarkMode: false,
  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

  userLocation: "Gurugram, Sector 49",
  setUserLocation: (location) => set({ userLocation: location }),

  selectedService: null,
  setSelectedService: (service) => set({ selectedService: service }),

  cart: [],
  addToCart: (item) =>
    set((state) => ({ cart: [...state.cart, item] })),
  removeFromCart: (itemId) =>
    set((state) => ({
      cart: state.cart.filter((item) => item.id !== itemId),
    })),
}));
