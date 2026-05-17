# HOMIGO Mobile App

Premium home services marketplace — React Native + Expo.

## Stack

- **Expo SDK 52** + Expo Router (file-based navigation)
- **React Native 0.76** (New Architecture enabled)
- **NativeWind v4** (Tailwind CSS for RN)
- **Zustand** (state) · **Axios** (API) · **Zod** (validation)
- **lucide-react-native** (icons) · **expo-linear-gradient** (gradients)

## Run

```bash
cd homigo-mobile
npm install --legacy-peer-deps
npm start          # Expo dev server (press w / a / i)
npm run web        # Web preview in browser
npm run android    # Android emulator
npm run ios        # iOS simulator (macOS only)
```

Scan the QR code with **Expo Go** on a physical device for the fastest preview.

## Structure

```
app/
  _layout.tsx          Root stack + providers
  (tabs)/
    _layout.tsx         Bottom tab navigator
    index.tsx           Home (Hero + Search + Services + Banner + Offers)
    bookings.tsx        Bookings
    ai.tsx              AI Assistant
    wallet.tsx          Wallet
    profile.tsx         Profile
src/
  components/           HeroSection, SearchBar, ServiceCategories,
                        FeatureBanner, OffersSection, Button, Card
  hooks/useTheme.ts     Light/dark theme resolver
  lib/                  colors, store (Zustand), api (Axios)
  types/                Shared TS types
```

## Design

Mirrors the HOMIGO web app's Luxury Aurora design language — same brand
palette (blue `#2563EB`, violet `#7C3AED`, cyan, pink, gold), gradients,
and premium card/shadow system, adapted for native mobile.
